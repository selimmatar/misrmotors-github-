namespace MisrMotorsSigner;

public interface ISigningSession
{
    bool Unlocked { get; }
    /// <summary>Finds the company certificate for the RIN and unlocks the token (the driver asks for the PIN).</summary>
    bool TryUnlock(string rin, out string error);
    string Sign(string canonical);
    /// <summary>True while the certificate in use is still the company's (in date, same token, the ERP's tax number).
    /// When it is not, the session locks itself so the certificate is chosen again at the next unlock.</summary>
    bool StillValid(string rin);
}

public enum Health { NotPaired, Offline, KeyRejected, PinNeeded, WrongCertificate, Refused, Ready }

public sealed record SignerState(Health Health, int Waiting, string Message);

/// <summary>One poll every 10 s, one ping every 60 s. Signs everything waiting while the token is unlocked.</summary>
public sealed class SignerLoop
{
    public const string Version = "1.0.0";
    readonly ISignerApi _api;
    readonly ISigningSession _session;
    readonly Action<SignerState> _onState;
    readonly Action<string> _log;
    string _rin = "";
    bool _wrongCert;
    int _waiting;
    // documents the ERP refused: not signed again until their text changes
    readonly Dictionary<long, (string Canonical, string Reason)> _refused = new();

    public SignerLoop(ISignerApi api, ISigningSession session, Action<SignerState> onState, Action<string>? log = null)
    { _api = api; _session = session; _onState = onState; _log = log ?? (_ => { }); }

    public string Rin => _rin;

    SignerState Current(Health h, string msg) => new(h, _waiting, msg);

    /// <summary>The user entered the PIN (or "sign now"): unlock, then sign what is waiting.</summary>
    public async Task SignNowAsync(CancellationToken ct)
    {
        try
        {
            var next = await _api.NextAsync(ct);
            _rin = next.Rin;
            _waiting = next.Documents.Count;
            if (_session.Unlocked && !CertificateOk()) { await TryPing(ct); return; }
            if (!_session.Unlocked)
            {
                if (!Unlock()) { await TryPing(ct); return; }
                // the PIN dialog can stay open for a long time: what is signed is what the ERP holds after it
                next = await _api.NextAsync(ct);
                _rin = next.Rin;
                _waiting = next.Documents.Count;
            }
            await SignAndPost(next.Documents, ct);
            await TryPing(ct);
        }
        catch (Exception e) { Fail(e); }
    }

    bool Unlock()
    {
        if (_session.TryUnlock(_rin, out var err))
        {
            _wrongCert = false;
            _refused.Clear(); // a new unlock may mean another certificate: everything is tried again
            return true;
        }
        _wrongCert = err.Contains("certificate", StringComparison.OrdinalIgnoreCase);
        _log("Unlock failed: " + err);
        _onState(Current(_wrongCert ? Health.WrongCertificate : Health.PinNeeded, err));
        return false;
    }

    /// <summary>Checks the certificate each cycle; when it is no longer the right one the token is locked and this is reported.</summary>
    bool CertificateOk()
    {
        if (_session.StillValid(_rin)) return true;
        _wrongCert = true;
        _refused.Clear();
        const string msg = "The company certificate is no longer valid for this tax number (expired, removed or replaced). Choose Enter PIN / sign now to select it again.";
        _log(msg);
        _onState(Current(Health.WrongCertificate, msg));
        return false;
    }

    /// <summary>One poll. Never throws.</summary>
    public async Task TickAsync(CancellationToken ct)
    {
        try
        {
            var next = await _api.NextAsync(ct);
            _rin = next.Rin;
            _waiting = next.Documents.Count;
            if (_session.Unlocked && !CertificateOk()) return;
            if (!_session.Unlocked)
            {
                _onState(Current(_wrongCert ? Health.WrongCertificate : Health.PinNeeded,
                    _waiting > 0 ? $"{_waiting} invoices waiting - enter PIN to sign" : "PIN needed"));
                return;
            }
            await SignAndPost(next.Documents, ct);
        }
        catch (Exception e) { Fail(e); }
    }

    async Task SignAndPost(IReadOnlyList<WaitingDocument> docs, CancellationToken ct)
    {
        // forget refusals of documents that are gone or whose text the ERP changed
        foreach (var id in _refused.Keys.ToList())
            if (!docs.Any(d => d.DocId == id && d.Canonical == _refused[id].Canonical)) _refused.Remove(id);
        var todo = docs.Where(d => !_refused.ContainsKey(d.DocId)).ToList();
        if (todo.Count == 0)
        {
            _waiting = docs.Count;
            if (_refused.Count > 0) ReportRefused();
            else { _waiting = 0; _onState(Current(Health.Ready, "Connected - nothing waiting")); }
            return;
        }
        var done = new List<(long, string)>();
        foreach (var d in todo)
        {
            try { done.Add((d.DocId, _session.Sign(d.Canonical))); }
            catch (Exception e) { _log($"Could not sign document {d.DocId}: {e.Message}"); break; } // PIN cancelled or token removed
        }
        var answer = done.Count > 0 ? await _api.PostSignedAsync(done, ct) : new SignedAnswer(Array.Empty<RefusedItem>(), Array.Empty<long>());
        if (done.Count > 0) _log($"Signed and sent {done.Count - answer.Refused.Count} document(s); the ERP refused {answer.Refused.Count}.");
        foreach (var r in answer.Refused)
        {
            var doc = todo.FirstOrDefault(d => d.DocId == r.DocId);
            if (doc is null) continue;
            _refused[r.DocId] = (doc.Canonical, r.Reason);
            _log($"The ERP refused document {r.DocId}: {r.Reason}");
        }
        _waiting = docs.Count - (done.Count - answer.Refused.Count);
        if (_refused.Count > 0) { ReportRefused(); return; }
        _onState(done.Count == todo.Count
            ? Current(Health.Ready, $"Signed {done.Count} document(s)")
            : Current(Health.PinNeeded, $"{_waiting} invoices waiting - enter PIN to sign"));
    }

    void ReportRefused()
    {
        var first = _refused.Values.First().Reason;
        var certificate = _refused.Values.Any(v => v.Reason.Contains("certificate", StringComparison.OrdinalIgnoreCase));
        var msg = $"The ERP refused {_refused.Count} invoice(s): {(first.Length > 0 ? first : "no reason given")} They are not signed again until they change in the ERP.";
        _onState(Current(certificate ? Health.WrongCertificate : Health.Refused, msg));
    }

    public async Task PingAsync(CancellationToken ct)
    {
        try { await _api.PingAsync(_session.Unlocked, Version, ct); }
        catch (Exception e) { Fail(e); }
    }

    async Task TryPing(CancellationToken ct) { try { await _api.PingAsync(_session.Unlocked, Version, ct); } catch { } }

    void Fail(Exception e)
    {
        _log("Problem: " + e.Message);
        if (e is OperationCanceledException && e.InnerException is null) return;
        _onState(e is KeyRejectedException
            ? Current(Health.KeyRejected, e.Message)
            : Current(Health.Offline, "Cannot reach the ERP: " + e.Message));
    }
}

/// <summary>The real session: the certificate chosen from CurrentUser\My, the key opened once and kept.</summary>
public sealed class TokenSession : ISigningSession
{
    System.Security.Cryptography.X509Certificates.X509Certificate2? _cert;
    public bool Unlocked { get; private set; }

    public bool TryUnlock(string rin, out string error)
    {
        error = "";
        try
        {
            _cert = CertificateFilter.FindInCurrentUserStore(rin, DateTime.UtcNow); // chosen again at every unlock
            if (_cert is null)
            {
                error = $"The company certificate (tax number {rin}) was not found - is the USB token plugged in? Other certificates are never used.";
                return false;
            }
            CadesSigner.Sign("unlock", _cert); // first use of the key: the token driver asks for the PIN here
            Unlocked = true;
            return true;
        }
        catch (Exception e)
        {
            Unlocked = false;
            error = "PIN needed: " + e.Message;
            return false;
        }
    }

    public bool StillValid(string rin)
    {
        if (!Unlocked || _cert is null) return true;
        bool ok;
        try
        {
            var now = DateTime.UtcNow;
            using var inStore = CertificateFilter.FindInCurrentUserStore(rin, now);
            ok = CertificateFilter.StillCurrent(_cert, inStore, rin, now);
        }
        catch { ok = false; }
        if (!ok) { _cert = null; Unlocked = false; }
        return ok;
    }

    public string Sign(string canonical)
    {
        if (_cert is null) throw new InvalidOperationException("Not unlocked.");
        try { return CadesSigner.Sign(canonical, _cert); }
        catch { Unlocked = false; throw; }
    }
}

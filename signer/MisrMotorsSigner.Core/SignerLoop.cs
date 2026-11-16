namespace MisrMotorsSigner;

public interface ISigningSession
{
    bool Unlocked { get; }
    /// <summary>Finds the company certificate for the RIN and unlocks the token (the driver asks for the PIN).</summary>
    bool TryUnlock(string rin, out string error);
    string Sign(string canonical);
}

public enum Health { NotPaired, Offline, KeyRejected, PinNeeded, WrongCertificate, Ready }

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
            if (!_session.Unlocked && !Unlock()) { await TryPing(ct); return; }
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
            return true;
        }
        _wrongCert = err.Contains("certificate", StringComparison.OrdinalIgnoreCase);
        _log("Unlock failed: " + err);
        _onState(Current(_wrongCert ? Health.WrongCertificate : Health.PinNeeded, err));
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
        if (docs.Count == 0) { _waiting = 0; _onState(Current(Health.Ready, "Connected - nothing waiting")); return; }
        var done = new List<(long, string)>();
        foreach (var d in docs)
        {
            try { done.Add((d.DocId, _session.Sign(d.Canonical))); }
            catch (Exception e) { _log($"Could not sign document {d.DocId}: {e.Message}"); break; } // PIN cancelled or token removed
        }
        if (done.Count > 0)
        {
            await _api.PostSignedAsync(done, ct);
            _log($"Signed and sent {done.Count} document(s).");
        }
        _waiting = docs.Count - done.Count;
        _onState(done.Count == docs.Count
            ? Current(Health.Ready, $"Signed {done.Count} document(s)")
            : Current(Health.PinNeeded, $"{_waiting} invoices waiting - enter PIN to sign"));
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
            _cert ??= CertificateFilter.FindInCurrentUserStore(rin, DateTime.UtcNow);
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

    public string Sign(string canonical)
    {
        if (_cert is null) throw new InvalidOperationException("Not unlocked.");
        try { return CadesSigner.Sign(canonical, _cert); }
        catch { Unlocked = false; throw; }
    }
}

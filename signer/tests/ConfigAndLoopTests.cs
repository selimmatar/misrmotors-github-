using System.Text;
using MisrMotorsSigner;

namespace MisrMotorsSigner.Tests;

sealed class FakeProtector : IKeyProtector
{
    public byte[] Protect(byte[] p) => p.Select(b => (byte)(b ^ 0x5A)).ToArray();
    public byte[] Unprotect(byte[] p) => Protect(p);
}

public class ConfigTests
{
    [Fact]
    public void Key_is_not_stored_in_plain_text_and_round_trips()
    {
        var path = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ".json");
        try
        {
            var store = new ConfigStore(path, new FakeProtector());
            store.Save(new SignerSettings("https://erp.example.com/", "SECRETKEY123"));
            Assert.DoesNotContain("SECRETKEY123", File.ReadAllText(path));
            var back = store.Load()!;
            Assert.Equal("https://erp.example.com", back.ServerUrl);
            Assert.Equal("SECRETKEY123", back.Key);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void Missing_file_or_bad_address_is_handled()
    {
        var store = new ConfigStore(Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ".json"), new FakeProtector());
        Assert.Null(store.Load());
        Assert.Throws<ArgumentException>(() => store.Save(new SignerSettings("erp", "k")));
    }
}

public class LoopTests
{
    sealed class Api : ISignerApi
    {
        public List<WaitingDocument> Docs = new();
        public List<(long, string)> Posted = new();
        public bool? LastUnlocked;
        public Exception? Fail;
        public int Nexts;
        public List<long> Refuse = new();
        public Action? OnNext;
        public Task<NextResult> NextAsync(CancellationToken ct) { Nexts++; OnNext?.Invoke(); return Fail is null ? Task.FromResult(new NextResult("test", "100060455", Docs.ToList())) : Task.FromException<NextResult>(Fail); }
        public Task<SignedAnswer> PostSignedAsync(IEnumerable<(long DocId, string Signature)> items, CancellationToken ct)
        {
            var list = items.ToList();
            Posted.AddRange(list);
            var refused = list.Where(i => Refuse.Contains(i.DocId)).Select(i => new RefusedItem(i.DocId, "The invoice changed after Send.")).ToList();
            return Task.FromResult(new SignedAnswer(refused, list.Where(i => !Refuse.Contains(i.DocId)).Select(i => i.DocId).ToList()));
        }
        public Task PingAsync(bool unlocked, string version, CancellationToken ct) { LastUnlocked = unlocked; return Task.CompletedTask; }
    }
    sealed class Session : ISigningSession
    {
        public bool Unlocked { get; set; }
        public bool CanUnlock = true;
        public Action? OnUnlock;
        public bool Valid = true;
        public int Signs;
        public bool TryUnlock(string rin, out string error) { OnUnlock?.Invoke(); error = CanUnlock ? "" : "PIN needed"; Unlocked = CanUnlock; return CanUnlock; }
        public string Sign(string c) { Signs++; return "SIG:" + c; }
        public bool StillValid(string rin) { if (!Valid) Unlocked = false; return Valid; }
    }

    [Fact]
    public async Task Locked_token_waits_then_sign_now_signs_everything()
    {
        var api = new Api { Docs = { new(1, "a"), new(2, "b") } };
        var ses = new Session();
        SignerState? last = null;
        var loop = new SignerLoop(api, ses, s => last = s);
        await loop.TickAsync(default);
        Assert.Equal(Health.PinNeeded, last!.Health);
        Assert.Equal(2, last.Waiting);
        Assert.Empty(api.Posted);
        await loop.SignNowAsync(default);
        Assert.Equal(2, api.Posted.Count);
        Assert.True(api.LastUnlocked);
        Assert.Equal(Health.Ready, last.Health);
    }

    [Fact]
    public async Task Unlocked_token_signs_on_poll_and_rejected_key_is_reported()
    {
        var api = new Api { Docs = { new(7, "x") } };
        SignerState? last = null;
        var loop = new SignerLoop(api, new Session { Unlocked = true }, s => last = s);
        await loop.TickAsync(default);
        Assert.Equal((7L, "SIG:x"), api.Posted[0]);
        api.Fail = new KeyRejectedException();
        await loop.TickAsync(default);
        Assert.Equal(Health.KeyRejected, last!.Health);
        api.Fail = new HttpRequestException("down");
        await loop.TickAsync(default);
        Assert.Equal(Health.Offline, last.Health);
    }

    [Fact]
    public async Task Documents_are_fetched_after_the_PIN_not_before()
    {
        // the PIN dialog stays open while the ERP changes the invoice: what is signed is what the ERP holds after the unlock
        var api = new Api { Docs = { new(1, "old text") } };
        var ses = new Session { OnUnlock = () => { api.Docs.Clear(); api.Docs.Add(new(1, "new text")); } };
        var loop = new SignerLoop(api, ses, _ => { });
        await loop.SignNowAsync(default);
        Assert.Equal((1L, "SIG:new text"), Assert.Single(api.Posted));
        Assert.Equal(2, api.Nexts);
    }

    [Fact]
    public async Task Refusals_are_shown_in_plain_words_and_not_signed_again_until_the_ERP_changes_the_document()
    {
        var api = new Api { Docs = { new(1, "a"), new(2, "b") }, Refuse = { 1 } };
        var ses = new Session { Unlocked = true };
        SignerState? last = null;
        var loop = new SignerLoop(api, ses, s => last = s);
        await loop.TickAsync(default);
        Assert.Equal(2, api.Posted.Count);
        Assert.Equal(Health.Refused, last!.Health);
        Assert.Contains("The invoice changed after Send.", last.Message);
        // later polls: the refused one is skipped (not signed in a loop), and the tray keeps saying so
        api.Docs.RemoveAll(d => d.DocId == 2);
        await loop.TickAsync(default);
        await loop.TickAsync(default);
        Assert.Equal(2, api.Posted.Count);
        Assert.Equal(2, ses.Signs);
        Assert.Equal(Health.Refused, last.Health);
        // the ERP changes the document: it is tried again
        api.Docs.Clear(); api.Docs.Add(new(1, "a, fixed")); api.Refuse.Clear();
        await loop.TickAsync(default);
        Assert.Equal((1L, "SIG:a, fixed"), api.Posted[^1]);
        Assert.Equal(Health.Ready, last.Health);
    }

    [Fact]
    public async Task A_certificate_that_is_no_longer_right_is_reported_and_the_token_locked()
    {
        var api = new Api { Docs = { new(1, "a") } };
        var ses = new Session { Unlocked = true, Valid = false };
        SignerState? last = null;
        var loop = new SignerLoop(api, ses, s => last = s);
        await loop.TickAsync(default);
        Assert.Empty(api.Posted);
        Assert.False(ses.Unlocked);
        Assert.Equal(Health.WrongCertificate, last!.Health);
        // chosen again after the user's "sign now" (a good certificate)
        ses.Valid = true;
        await loop.SignNowAsync(default);
        Assert.Single(api.Posted);
        Assert.Equal(Health.Ready, last.Health);
    }

    [Fact]
    public void The_signed_answer_is_read_for_refused_items()
    {
        var a = SignerApi.ParseSigned("{\"submitted\":[2],\"invalid\":[],\"unconfirmed\":[],\"refused\":[{\"docId\":1,\"reason\":\"The certificate is expired.\"}]}", new long[] { 1, 2 });
        Assert.Equal(new RefusedItem(1, "The certificate is expired."), Assert.Single(a.Refused));
        Assert.Equal(new long[] { 2 }, a.Accepted);
        Assert.Empty(SignerApi.ParseSigned("not json", new long[] { 1 }).Refused);
    }
}

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
        public Task<NextResult> NextAsync(CancellationToken ct) => Fail is null ? Task.FromResult(new NextResult("test", "100060455", Docs)) : Task.FromException<NextResult>(Fail);
        public Task PostSignedAsync(IEnumerable<(long DocId, string Signature)> items, CancellationToken ct) { Posted.AddRange(items); return Task.CompletedTask; }
        public Task PingAsync(bool unlocked, string version, CancellationToken ct) { LastUnlocked = unlocked; return Task.CompletedTask; }
    }
    sealed class Session : ISigningSession
    {
        public bool Unlocked { get; set; }
        public bool CanUnlock = true;
        public bool TryUnlock(string rin, out string error) { error = CanUnlock ? "" : "PIN needed"; Unlocked = CanUnlock; return CanUnlock; }
        public string Sign(string c) => "SIG:" + c;
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
}

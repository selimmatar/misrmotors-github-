using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MisrMotorsSigner;

public sealed record WaitingDocument(
    [property: JsonPropertyName("docId")] long DocId,
    [property: JsonPropertyName("canonical")] string Canonical);

public sealed record NextResult(string Environment, string Rin, IReadOnlyList<WaitingDocument> Documents);

public sealed class KeyRejectedException : Exception
{
    public KeyRejectedException() : base("The ERP does not accept this signer key (it was disconnected or replaced).") { }
}

public interface ISignerApi
{
    Task<NextResult> NextAsync(CancellationToken ct);
    Task PostSignedAsync(IEnumerable<(long DocId, string Signature)> items, CancellationToken ct);
    Task PingAsync(bool unlocked, string version, CancellationToken ct);
}

/// <summary>The ERP protocol: GET /api/eta-signer/next, POST /api/eta-signer/signed, POST /api/eta-signer/ping,
/// all with the key in the x-eta-signer-key header.</summary>
public sealed class SignerApi : ISignerApi
{
    public const string KeyHeader = "x-eta-signer-key";
    readonly HttpClient _http;
    readonly string _base;
    readonly string _key;

    public SignerApi(HttpClient http, string serverUrl, string key)
    {
        _http = http; _base = serverUrl.TrimEnd('/'); _key = key.Trim();
    }

    HttpRequestMessage Req(HttpMethod m, string path, HttpContent? body = null)
    {
        var r = new HttpRequestMessage(m, _base + path) { Content = body };
        r.Headers.Add(KeyHeader, _key);
        return r;
    }

    static async Task Check(HttpResponseMessage r, CancellationToken ct)
    {
        if (r.StatusCode == HttpStatusCode.Unauthorized) throw new KeyRejectedException();
        if (!r.IsSuccessStatusCode)
        {
            var text = await r.Content.ReadAsStringAsync(ct);
            throw new HttpRequestException($"ERP answered {(int)r.StatusCode}: {(text.Length > 200 ? text[..200] : text)}");
        }
    }

    public async Task<NextResult> NextAsync(CancellationToken ct)
    {
        using var r = await _http.SendAsync(Req(HttpMethod.Get, "/api/eta-signer/next"), ct);
        await Check(r, ct);
        using var doc = JsonDocument.Parse(await r.Content.ReadAsStringAsync(ct));
        var root = doc.RootElement;
        var docs = new List<WaitingDocument>();
        if (root.TryGetProperty("documents", out var arr) && arr.ValueKind == JsonValueKind.Array)
            foreach (var d in arr.EnumerateArray())
                docs.Add(new WaitingDocument(d.GetProperty("docId").GetInt64(), d.GetProperty("canonical").GetString() ?? ""));
        return new NextResult(
            root.TryGetProperty("environment", out var e) ? e.GetString() ?? "" : "",
            root.TryGetProperty("rin", out var rin) ? rin.GetString() ?? "" : "",
            docs);
    }

    public async Task PostSignedAsync(IEnumerable<(long DocId, string Signature)> items, CancellationToken ct)
    {
        var body = JsonContent.Create(new { items = items.Select(i => new { docId = i.DocId, signature = i.Signature }).ToArray() });
        using var r = await _http.SendAsync(Req(HttpMethod.Post, "/api/eta-signer/signed", body), ct);
        await Check(r, ct);
    }

    public async Task PingAsync(bool unlocked, string version, CancellationToken ct)
    {
        using var r = await _http.SendAsync(Req(HttpMethod.Post, "/api/eta-signer/ping", JsonContent.Create(new { unlocked, version })), ct);
        await Check(r, ct);
    }
}

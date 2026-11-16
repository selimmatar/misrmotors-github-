using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace MisrMotorsSigner;

public interface IKeyProtector
{
    byte[] Protect(byte[] plain);
    byte[] Unprotect(byte[] protectedBytes);
}

/// <summary>Windows DPAPI, current user: only this Windows user can read the stored key.</summary>
[System.Runtime.Versioning.SupportedOSPlatform("windows")]
public sealed class DpapiProtector : IKeyProtector
{
    public byte[] Protect(byte[] plain) => ProtectedData.Protect(plain, null, DataProtectionScope.CurrentUser);
    public byte[] Unprotect(byte[] p) => ProtectedData.Unprotect(p, null, DataProtectionScope.CurrentUser);
}

public sealed record SignerSettings(string ServerUrl, string Key);

/// <summary>Server address and signer key, per Windows user. The key is stored DPAPI-protected; the PIN is never stored.</summary>
public sealed class ConfigStore
{
    readonly string _path;
    readonly IKeyProtector _protector;

    public ConfigStore(string path, IKeyProtector protector) { _path = path; _protector = protector; }

    public static string DefaultPath() =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MisrMotorsSigner", "config.json");

    sealed class Disk { public string? ServerUrl { get; set; } public string? ProtectedKey { get; set; } }

    public static string NormalizeUrl(string url)
    {
        var u = (url ?? "").Trim().TrimEnd('/');
        if (!Uri.TryCreate(u, UriKind.Absolute, out var uri) || (uri.Scheme != "https" && uri.Scheme != "http"))
            throw new ArgumentException("The server address must start with https://");
        return u;
    }

    public void Save(SignerSettings s)
    {
        var key = (s.Key ?? "").Trim();
        if (key.Length == 0) throw new ArgumentException("The signer key is empty.");
        var disk = new Disk
        {
            ServerUrl = NormalizeUrl(s.ServerUrl),
            ProtectedKey = Convert.ToBase64String(_protector.Protect(Encoding.UTF8.GetBytes(key))),
        };
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        File.WriteAllText(_path, JsonSerializer.Serialize(disk));
    }

    /// <summary>The saved settings, or null when not paired yet or the file cannot be read by this Windows user.</summary>
    public SignerSettings? Load()
    {
        try
        {
            if (!File.Exists(_path)) return null;
            var d = JsonSerializer.Deserialize<Disk>(File.ReadAllText(_path));
            if (d?.ServerUrl is null || d.ProtectedKey is null) return null;
            var key = Encoding.UTF8.GetString(_protector.Unprotect(Convert.FromBase64String(d.ProtectedKey)));
            return new SignerSettings(d.ServerUrl, key);
        }
        catch (Exception e) when (e is CryptographicException or JsonException or FormatException or IOException) { return null; }
    }

    public void Clear() { try { File.Delete(_path); } catch (IOException) { } }
}

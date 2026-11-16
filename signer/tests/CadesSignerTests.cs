using System.Security.Cryptography;
using System.Security.Cryptography.Pkcs;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using MisrMotorsSigner;

namespace MisrMotorsSigner.Tests;

public class CadesSignerTests
{
    const string Text = "\"DOCUMENT\"\"issuer\"\"EG-100060455\"";

    static X509Certificate2 Cert(string subject)
    {
        using var rsa = RSA.Create(2048);
        var req = new CertificateRequest(subject, rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using var c = req.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(1));
        return new X509Certificate2(c.Export(X509ContentType.Pfx)); // keeps the private key
    }

    static SignedCms Decode(string b64, string text)
    {
        var cms = new SignedCms(new ContentInfo(Encoding.UTF8.GetBytes(text)), detached: true);
        cms.Decode(Convert.FromBase64String(b64));
        return cms;
    }

    [Fact]
    public void Signature_verifies_over_same_text_and_fails_over_changed_text()
    {
        using var cert = Cert("CN=Misr Motors, O=EG-100060455");
        var sig = CadesSigner.Sign(Text, cert);
        Decode(sig, Text).CheckSignature(true);
        Assert.ThrowsAny<CryptographicException>(() => Decode(sig, Text + "x").CheckSignature(true));
    }

    [Fact]
    public void Signature_is_detached_sha256_with_expected_attributes()
    {
        using var cert = Cert("CN=Misr Motors, O=EG-100060455");
        var cms = Decode(CadesSigner.Sign(Text, cert), Text);
        Assert.Equal(1, cms.SignerInfos.Count);
        var info = cms.SignerInfos[0];
        Assert.Equal("2.16.840.1.101.3.4.2.1", info.DigestAlgorithm.Value);
        var oids = info.SignedAttributes.Cast<CryptographicAttributeObject>().Select(a => a.Oid.Value).ToList();
        Assert.Contains("1.2.840.113549.1.9.3", oids);   // content type
        Assert.Contains("1.2.840.113549.1.9.4", oids);   // message digest
        Assert.Contains("1.2.840.113549.1.9.5", oids);   // signing time
        Assert.Contains(CadesSigner.OidSigningCertificateV2, oids);
        var digest = info.SignedAttributes.Cast<CryptographicAttributeObject>().First(a => a.Oid.Value == "1.2.840.113549.1.9.4").Values[0];
        var expected = SHA256.HashData(Encoding.UTF8.GetBytes(Text));
        Assert.Equal(expected, new Pkcs9MessageDigest().Also(d => d.CopyFrom(digest)).MessageDigest);
    }

    [Fact]
    public void Signing_certificate_v2_holds_the_certificate_hash()
    {
        using var cert = Cert("CN=Misr Motors, O=EG-100060455");
        var cms = Decode(CadesSigner.Sign(Text, cert), Text);
        var attr = cms.SignerInfos[0].SignedAttributes.Cast<CryptographicAttributeObject>().First(a => a.Oid.Value == CadesSigner.OidSigningCertificateV2);
        var raw = attr.Values[0].RawData;
        var hash = SHA256.HashData(cert.RawData);
        Assert.True(raw.AsSpan().IndexOf(hash) > 0);
    }

    [Fact]
    public void Signature_carries_the_signer_certificate_not_the_text()
    {
        using var cert = Cert("CN=Misr Motors, O=EG-100060455");
        var cms = Decode(CadesSigner.Sign(Text, cert), Text);
        Assert.Equal(cert.Thumbprint, cms.Certificates[0].Thumbprint);
        Assert.True(Convert.ToBase64String(cms.Encode()).Length < 20000);
    }

    [Fact]
    public void Filter_refuses_certificate_without_the_rin_and_accepts_the_right_one()
    {
        using var good = Cert("CN=Misr Motors, O=EG-100060455");
        using var other = Cert("CN=Someone Else, O=EG-200000001");
        using var partial = Cert("CN=Looks Close, O=1100060455");
        var col = new X509Certificate2Collection(new[] { other, partial });
        Assert.Null(CertificateFilter.Find(col, "100060455", DateTime.UtcNow));
        col.Add(good);
        Assert.Equal(good.Thumbprint, CertificateFilter.Find(col, "100060455", DateTime.UtcNow)?.Thumbprint);
        Assert.Null(CertificateFilter.Find(col, "100060455", DateTime.UtcNow.AddYears(5))); // expired
    }

    [Fact]
    public void Certificate_is_checked_again_for_expiry_a_swapped_token_and_the_RIN()
    {
        using var cert = Cert("CN=Misr Motors, O=EG-100060455");
        using var swapped = Cert("CN=Misr Motors, O=EG-100060455");
        var now = DateTime.UtcNow;
        Assert.True(CertificateFilter.StillCurrent(cert, cert, "100060455", now));
        Assert.False(CertificateFilter.StillCurrent(cert, cert, "100060455", now.AddYears(5)), "expired");
        Assert.False(CertificateFilter.StillCurrent(cert, null, "100060455", now), "token removed");
        Assert.False(CertificateFilter.StillCurrent(cert, swapped, "100060455", now), "another certificate in the store now");
        Assert.False(CertificateFilter.StillCurrent(cert, cert, "200000001", now), "the ERP's tax number changed");
    }
}

static class Ext { public static T Also<T>(this T t, Action<T> a) { a(t); return t; } }

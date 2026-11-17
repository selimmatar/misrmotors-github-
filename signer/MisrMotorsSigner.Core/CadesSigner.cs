using System.Formats.Asn1;
using System.Security.Cryptography;
using System.Security.Cryptography.Pkcs;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.RegularExpressions;

namespace MisrMotorsSigner;

/// <summary>CAdES-BES signing exactly as the ERP verifies it (lib/eta/cms.ts): detached SignedData, SHA-256,
/// message-digest over the UTF-8 canonical text, signing time, content type, ESS signing-certificate-v2.</summary>
public static class CadesSigner
{
    public const string OidSigningCertificateV2 = "1.2.840.113549.1.9.16.2.47";
    public const string OidEtaContentType = "1.2.840.113549.1.7.5";

    /// <summary>Signs the canonical text; returns the Base64 of the DER CMS.</summary>
    public static string Sign(string canonical, X509Certificate2 cert)
    {
        if (string.IsNullOrEmpty(canonical)) throw new ArgumentException("Nothing to sign.", nameof(canonical));
        var data = new UTF8Encoding(false).GetBytes(canonical);
        // The ETA portal accepts only the content type its own signer uses: 1.2.840.113549.1.7.5 (otherwise error 4062
        // "Attached digital signature is not supported").
        var cms = new SignedCms(new ContentInfo(new Oid(OidEtaContentType), data), detached: true);
        var signer = new CmsSigner(SubjectIdentifierType.IssuerAndSerialNumber, cert)
        {
            DigestAlgorithm = new Oid("2.16.840.1.101.3.4.2.1"), // SHA-256
            IncludeOption = X509IncludeOption.EndCertOnly,
        };
        signer.SignedAttributes.Add(new Pkcs9SigningTime(DateTime.UtcNow));
        signer.SignedAttributes.Add(new AsnEncodedData(new Oid(OidSigningCertificateV2), SigningCertificateV2(cert)));
        cms.ComputeSignature(signer, silent: false); // content type + message digest are added by the framework
        return Convert.ToBase64String(cms.Encode());
    }

    /// <summary>SigningCertificateV2 ::= SEQUENCE { certs SEQUENCE OF ESSCertIDv2 }; hashAlgorithm omitted = SHA-256.</summary>
    static byte[] SigningCertificateV2(X509Certificate2 cert)
    {
        var hash = SHA256.HashData(cert.RawData);
        var w = new AsnWriter(AsnEncodingRules.DER);
        using (w.PushSequence())          // SigningCertificateV2
        using (w.PushSequence())          // certs
        using (w.PushSequence())          // ESSCertIDv2
        {
            w.WriteOctetString(hash);
            using (w.PushSequence())      // IssuerSerial
            {
                using (w.PushSequence())  // GeneralNames
                using (w.PushSequence(new Asn1Tag(TagClass.ContextSpecific, 4, true))) // directoryName [4] EXPLICIT
                    w.WriteEncodedValue(cert.IssuerName.RawData);
                w.WriteIntegerUnsigned(cert.SerialNumberBytes.Span);
            }
        }
        return w.Encode();
    }
}

public static class CertificateFilter
{
    /// <summary>True when the text holds the RIN as a whole number ("EG-100060455" yes, "1100060455" no).</summary>
    public static bool HoldsRin(string value, string rin) =>
        Regex.IsMatch(rin ?? "", @"^\d+$") && Regex.IsMatch(value ?? "", $@"(^|\D){rin}(\D|$)");

    public static bool Matches(X509Certificate2 cert, string rin, DateTime now) =>
        cert.HasPrivateKey && cert.NotBefore <= now && now <= cert.NotAfter && HoldsRin(cert.Subject, rin);

    /// <summary>The certificate in use is still the right one: the same one is still in the store (token not removed
    /// or swapped), it is in date, has its key and holds the ERP's current tax number.</summary>
    public static bool StillCurrent(X509Certificate2 cert, X509Certificate2? inStore, string rin, DateTime now) =>
        inStore is not null && inStore.Thumbprint == cert.Thumbprint && Matches(cert, rin, now);

    /// <summary>The company's e-seal in the store, or null. Certificates for any other number are never used.</summary>
    public static X509Certificate2? Find(X509Certificate2Collection certs, string rin, DateTime now) =>
        certs.Cast<X509Certificate2>().Where(c => Matches(c, rin, now)).OrderByDescending(c => c.NotAfter).FirstOrDefault();

    public static X509Certificate2? FindInCurrentUserStore(string rin, DateTime now)
    {
        using var store = new X509Store(StoreName.My, StoreLocation.CurrentUser);
        store.Open(OpenFlags.ReadOnly);
        return Find(store.Certificates, rin, now);
    }
}

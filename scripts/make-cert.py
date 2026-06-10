# Generuje self-signed certyfikat dev (certs/dev-cert.pem + dev-key.pem)
# z SAN: localhost, 127.0.0.1 i wszystkie adresy IPv4 maszyny (LAN).
# Użycie:  backend\.venv\Scripts\python.exe scripts\make-cert.py
# Po stronie KAŻDEGO urządzenia testowego trzeba raz zaakceptować ostrzeżenie
# przeglądarki dla obu originów (https://HOST:5174 i https://HOST:8000).
import datetime
import ipaddress
import socket
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

CERTS_DIR = Path(__file__).resolve().parents[1] / "certs"


def local_ipv4_addresses() -> list[str]:
    ips = {"127.0.0.1"}
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except socket.gaierror:
        pass
    return sorted(ips)


def main() -> None:
    CERTS_DIR.mkdir(exist_ok=True)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    ips = local_ipv4_addresses()
    san = [x509.DNSName("localhost")] + [x509.IPAddress(ipaddress.ip_address(ip)) for ip in ips]

    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "NovaMed dev")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=825))
        .add_extension(x509.SubjectAlternativeName(san), critical=False)
        .sign(key, hashes.SHA256())
    )

    (CERTS_DIR / "dev-key.pem").write_bytes(key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption(),
    ))
    (CERTS_DIR / "dev-cert.pem").write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    print(f"Certyfikat: {CERTS_DIR}\\dev-cert.pem")
    print(f"SAN: localhost, {', '.join(ips)}")


if __name__ == "__main__":
    main()

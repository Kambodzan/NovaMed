# CopyEmailClient: dostawa do oryginalnego adresata + kopia na staly adres (demo).
from app.integrations.email import CopyEmailClient


class Recorder:
    def __init__(self):
        self.sent: list[tuple] = []

    def send(self, *, to, subject, body):
        self.sent.append((to, subject, body))


def test_copy_goes_to_user_and_copy():
    rec = Recorder()
    CopyEmailClient(rec, "kopia@demo.pl").send(to="user@x.pl", subject="Temat", body="Tresc")
    assert [s[0] for s in rec.sent] == ["user@x.pl", "kopia@demo.pl"]
    assert "kopia" in rec.sent[1][1].lower()           # kopia oznaczona w temacie
    assert "user@x.pl" in rec.sent[1][2]               # widac, do kogo szedl oryginal


def test_copy_skipped_when_same_address():
    rec = Recorder()
    CopyEmailClient(rec, "user@x.pl").send(to="USER@x.pl", subject="T", body="B")
    assert [s[0] for s in rec.sent] == ["USER@x.pl"]   # case-insensitive, bez dubla

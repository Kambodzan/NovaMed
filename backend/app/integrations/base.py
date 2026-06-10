class IntegrationError(Exception):
    """Błąd komunikacji z systemem zewnętrznym (lub odrzucenie dokumentu).

    Logika domenowa NIE zna szczegółów transportu — dostaje komunikat
    nadający się do pokazania lekarzowi (sekwencja: 'Możliwość poprawy
    danych i ponownego wysłania')."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message

# Obraz backendu NovaMed (API). Wieloinstancyjny za load-balancerem (HA) — patrz
# docker-compose.ha.yml. Liczba workerow per instancja przez WEB_CONCURRENCY.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    WEB_CONCURRENCY=4

WORKDIR /app

# zaleznosci (osobna warstwa cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# nieuprzywilejowany uzytkownik
RUN useradd -m -u 1000 novamed && chown -R novamed:novamed /app
USER novamed

EXPOSE 8000

# readiness probe dla orkiestratora/LB
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health/db').status==200 else 1)" || exit 1

# migracje + serwer; --workers skaluje per instancja (WEB_CONCURRENCY)
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY}"]

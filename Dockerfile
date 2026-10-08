# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Non-root system user with fixed UID/GID
RUN groupadd --system --gid 10001 dfms \
 && useradd  --system --uid 10001 --gid dfms --no-create-home --shell /usr/sbin/nologin dfms

WORKDIR /srv
# Runtime has no third-party dependencies, so there is nothing to pip install.
COPY --chown=root:root app/ ./app/

USER 10001:10001
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2).status == 200 else 1)"]

ENTRYPOINT ["python", "-m", "app.main"]

# Backend production Dockerfile
# Multi-stage build that installs only production dependencies and runs as a
# non-root user. Tests and dev dependencies are intentionally excluded from the
# final image.

FROM python:3.12-slim AS builder

WORKDIR /app

COPY pyproject.toml ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --user .

FROM python:3.12-slim AS production

WORKDIR /app

COPY --from=builder --chown=app:app /root/.local /home/app/.local
COPY --chown=app:app src ./src
COPY --chown=app:app alembic.ini ./alembic.ini
COPY --chown=app:app alembic ./alembic
COPY --chown=app:app docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

RUN groupadd -r app && useradd -r -g app app && chown -R app:app /app
USER app

ENV PYTHONPATH=/app/src
ENV PATH=/home/app/.local/bin:$PATH
ENV PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=5)" || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]

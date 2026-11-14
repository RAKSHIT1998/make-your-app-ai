# Website reader for "Start from your current website". Runs Crawl4AI with headless Chromium, apart from the API.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 CRAWL4AI_NO_CLOUD_NOTICE=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright PORT=10000
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
 && python -m playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* /root/.cache
COPY app.py guard.py ./
RUN useradd --create-home --uid 10001 crawler && chmod -R a+rX /ms-playwright
USER crawler
EXPOSE 10000
HEALTHCHECK CMD python -c "import urllib.request,os;urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/health',timeout=3)"
CMD ["sh", "-c", "exec uvicorn app:app --host 0.0.0.0 --port ${PORT} --workers 1"]

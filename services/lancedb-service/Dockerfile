FROM python:3.11-slim

WORKDIR /app

# System deps for pyarrow / numpy
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc g++ && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

# Pre-download the embedding model at build time so startup is fast
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

EXPOSE 8100

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8100"]

# CloudTax x Ownr backend — FastAPI (uvicorn) + MongoDB driver.
FROM python:3.12-slim

WORKDIR /app

# build tools for any wheels that need compiling (numpy/pandas pins etc.)
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# emergentintegrations is a private package — needs the extra index or the app
# won't boot (hard import in ai_service.py -> server.py).
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt \
       --extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/

COPY . .

RUN chmod +x docker-entrypoint.sh
EXPOSE 8001
ENTRYPOINT ["./docker-entrypoint.sh"]

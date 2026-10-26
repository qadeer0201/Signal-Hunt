# Build from the Signal Hunt project root: docker build -t signal-hunt .
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    STRICT_SECURITY=1 \
    FRONTEND_DIR=/app/Frontend \
    MAX_TEAMS=10 \
    GAME_DURATION_MINUTES=80 \
    DATABASE_PATH=/data/signalhunt.db \
    PORT=8000
WORKDIR /app
COPY Backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY Backend/app ./app
COPY Frontend ./Frontend
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]

# HPO Diagnostics — single image: FastAPI + static React (Vite) build
# Railway: set PORT (injected). Root URL serves UI; /api/* is the backend.

FROM node:20-alpine AS frontend
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
COPY backend/requirements.txt /app/backend/
RUN pip install --no-cache-dir scipy pandas && \
    pip install --no-cache-dir -r /app/backend/requirements.txt
COPY backend /app/backend
COPY --from=frontend /src/dist /app/static
WORKDIR /app/backend
EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]

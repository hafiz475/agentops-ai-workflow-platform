FROM python:3.12-slim
WORKDIR /app
COPY apps/ai-service/pyproject.toml ./
COPY apps/ai-service/app ./app
RUN pip install --no-cache-dir .
RUN useradd --create-home --uid 10001 agentops
USER agentops
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]


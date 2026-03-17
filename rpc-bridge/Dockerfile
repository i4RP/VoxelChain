FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY voxelchain_bridge/ ./voxelchain_bridge/

# Create data directory
RUN mkdir -p /data/world

ENV VOXELCHAIN_DATA_DIR=/data
ENV PYTHONUNBUFFERED=1

EXPOSE 8546

CMD ["python", "-m", "voxelchain_bridge", "--host", "0.0.0.0", "--port", "8546"]

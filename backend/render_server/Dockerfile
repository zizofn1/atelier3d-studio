FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV BLENDER_VERSION=4.2.3
ENV BLENDER_PATH=/opt/blender/blender

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl xz-utils python3 python3-pip python3-venv \
    libx11-6 libxxf86vm1 libxfixes3 libxi6 libxrender1 libgl1 libgomp1 libsm6 libxkbcommon0 \
    && rm -rf /var/lib/apt/lists/*

RUN curl -L "https://download.blender.org/release/Blender4.2/blender-${BLENDER_VERSION}-linux-x64.tar.xz" -o /tmp/blender.tar.xz \
    && mkdir -p /opt/blender \
    && tar -xf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 \
    && rm /tmp/blender.tar.xz

WORKDIR /app
COPY requirements.txt .
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

COPY server.py render_cycles.py blender_worker.py ./

EXPOSE 8787
CMD ["/opt/venv/bin/uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8787"]

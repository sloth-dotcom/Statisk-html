# DataFlow Web UI — Hugging Face Docker Space
# Self-contained build of the OpenDCAI DataFlow framework + DataFlow-WebUI
# release. No build context is needed; every artifact is fetched here.
FROM python:3.11-slim

ARG DATAFLOW_WEBUI_VERSION=v0.0.8

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HOME=/home/user \
    TIKTOKEN_CACHE_DIR=/home/user/.cache/tiktoken \
    HF_HOME=/home/user/.cache/huggingface

# Build tools (curl/unzip) + shared libraries the ML stack loads at runtime:
# libgomp1 (OpenMP) for torch/scikit-learn, libsndfile1 for audio pipelines.
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl unzip ca-certificates libgomp1 libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Heavy step: the DataFlow framework (torch, transformers, ray, ...).
RUN pip install open-dataflow

# Hugging Face Spaces runs the container as a non-root user (UID 1000).
RUN useradd -m -u 1000 user

WORKDIR /home/user/app

# Download + unpack the DataFlow-WebUI release and install its backend deps.
RUN curl -fsSL -o /tmp/webui.zip \
      "https://github.com/OpenDCAI/DataFlow-WebUI/releases/download/${DATAFLOW_WEBUI_VERSION}/DataFlow-WebUI-${DATAFLOW_WEBUI_VERSION}.zip" \
 && unzip -q /tmp/webui.zip -d /home/user/app \
 && rm /tmp/webui.zip \
 && pip install -r "DataFlow-WebUI-${DATAFLOW_WEBUI_VERSION}/backend/requirements.txt"

# Pre-cache the cl100k_base tiktoken encoding. One operator evaluates
# tiktoken.get_encoding("cl100k_base") at import time and the WebUI imports
# every operator on startup, so a blocked encoding download would break boot.
RUN mkdir -p "$TIKTOKEN_CACHE_DIR" \
 && curl -fsSL -o "$TIKTOKEN_CACHE_DIR/9b5ad71b2ce5302211f9c61530b329a4922fc6a4" \
      https://raw.githubusercontent.com/niieani/gpt-tokenizer/main/data/cl100k_base.tiktoken

# The WebUI writes runtime data under backend/data/; hand the tree to the user.
RUN chown -R user:user /home/user

USER user
WORKDIR /home/user/app/DataFlow-WebUI-${DATAFLOW_WEBUI_VERSION}/backend

# Hugging Face Spaces routes the public URL to this port (see README app_port).
EXPOSE 7860
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]

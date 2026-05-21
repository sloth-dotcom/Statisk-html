---
title: DataFlow WebUI
short_description: Visual pipeline builder for OpenDCAI DataFlow
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# DataFlow WebUI

A Hugging Face Docker Space running the [OpenDCAI DataFlow](https://github.com/OpenDCAI/DataFlow)
Web UI — a visual, drag-and-drop builder for data-preparation pipelines.

The image installs `open-dataflow` and the DataFlow-WebUI release, then serves
the FastAPI backend (which also serves the built frontend) on port 7860. The
first load takes a minute or two while the operator catalog imports.

Running GPU pipelines requires a GPU-backed Space; browsing and building
pipelines works on the free CPU tier.

SHELL := /bin/bash

export PATH := $(HOME)/.local/bin:$(HOME)/.local/usr/bin:$(PATH)

OLLAMA ?= ollama
OLLAMA_MODEL ?= qwen3.5:4b
OLLAMA_HOST ?= 127.0.0.1:11434
OLLAMA_CONTEXT_LENGTH ?= 65536
OLLAMA_URL ?= http://$(OLLAMA_HOST)
OLLAMA_LOG ?= $(HOME)/.cache/agent-office/ollama.log

OFFICE_AGENT ?= opencode
OFFICE_HOST ?= 127.0.0.1
OFFICE_HOME ?= $(HOME)/agent-office
OFFICE_PORT ?= 4600
OFFICE_PASSWORD ?= dev
NETWORK_PASSWORD ?=
VITE_HOST ?= 127.0.0.1
VITE_PORT ?= 5173
export NETWORK_PASSWORD

.PHONY: help check-local check-network start-local start-network

help:
	@printf '%s\n' \
	  'make start-local  Start Ollama, the local model, and Agent Office' \
	  'make start-network NETWORK_PASSWORD=<long-random-password>  Share on your LAN' \
	  'Overrides: OLLAMA_MODEL, OLLAMA_HOST, OLLAMA_CONTEXT_LENGTH,' \
	  '           OFFICE_AGENT, OFFICE_HOME, OFFICE_HOST, OFFICE_PORT,' \
	  '           OFFICE_PASSWORD, NETWORK_PASSWORD, VITE_HOST, VITE_PORT'

check-local:
	@node -e 'if (Number(process.versions.node.split(".")[0]) < 20) { console.error("Node.js 20 or newer is required"); process.exit(1); }'
	@command -v npm >/dev/null || { echo 'npm is required'; exit 1; }
	@command -v curl >/dev/null || { echo 'curl is required'; exit 1; }
	@command -v $(OLLAMA) >/dev/null || { echo 'Install Ollama first: https://ollama.com/download'; exit 1; }
	@command -v opencode >/dev/null || { echo 'Install OpenCode first: https://opencode.ai'; exit 1; }
	@if [ ! -x node_modules/.bin/vite ]; then npm install; fi

check-network:
	@if [ "$${#NETWORK_PASSWORD}" -lt 20 ]; then echo 'Set NETWORK_PASSWORD to a random password of at least 20 characters (generate one with: openssl rand -hex 24)'; exit 1; fi
	@case "$$NETWORK_PASSWORD" in *[!A-Za-z0-9_-]*) echo 'NETWORK_PASSWORD may contain only letters, numbers, underscores and hyphens'; exit 1;; esac

start-local: check-local
	@set -eu; \
	mkdir -p "$(dir $(OLLAMA_LOG))"; \
	if ! curl -fsS "$(OLLAMA_URL)/api/version" >/dev/null 2>&1; then \
	  echo 'Starting Ollama with context $(OLLAMA_CONTEXT_LENGTH)...'; \
	  OLLAMA_CONTEXT_LENGTH="$(OLLAMA_CONTEXT_LENGTH)" OLLAMA_HOST="$(OLLAMA_HOST)" nohup "$(OLLAMA)" serve >"$(OLLAMA_LOG)" 2>&1 </dev/null & \
	  attempt=0; \
	  until curl -fsS "$(OLLAMA_URL)/api/version" >/dev/null 2>&1; do \
	    attempt=$$((attempt + 1)); \
	    if [ "$$attempt" -ge 60 ]; then cat "$(OLLAMA_LOG)"; echo 'Ollama did not start'; exit 1; fi; \
	    sleep 1; \
	  done; \
	else \
	  echo 'Reusing the Ollama server at $(OLLAMA_URL)'; \
	fi; \
	if ! OLLAMA_HOST="$(OLLAMA_HOST)" "$(OLLAMA)" list | awk -v model='$(OLLAMA_MODEL)' 'NR > 1 && $$1 == model { found = 1 } END { exit !found }'; then \
	  OLLAMA_HOST="$(OLLAMA_HOST)" "$(OLLAMA)" pull "$(OLLAMA_MODEL)"; \
	fi
	@PATH="$(PATH)" OFFICE_PORT="$(OFFICE_PORT)" npx concurrently -k \
	  "vite --host $(VITE_HOST) --port $(VITE_PORT) --strictPort" \
	  "tsx watch src/server/cli.ts --home '$(OFFICE_HOME)' --host $(OFFICE_HOST) --port $(OFFICE_PORT) --password '$(OFFICE_PASSWORD)' --agent '$(OFFICE_AGENT)'"

start-network: check-network
	@OFFICE_PASSWORD="$$NETWORK_PASSWORD" $(MAKE) start-local OFFICE_HOST=0.0.0.0 VITE_HOST=0.0.0.0

FROM node:20-alpine

# System dependencies
RUN apk add --no-cache \
    git \
    bash \
    curl \
    jq

# cdxgen — SBOM generation
RUN npm install -g @cyclonedx/cdxgen@11

# Trivy — vulnerability scanning
RUN curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh \
    | sh -s -- -b /usr/local/bin

# sbom-sentinel
RUN npm install -g sbom-sentinel

WORKDIR /app

# Default config location — mount your sbom-sentinel.config.json here
VOLUME ["/app/artifacts"]

ENTRYPOINT ["sbom-sentinel"]
CMD ["scan"]

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

# sbom-sentinel — installed from private Verdaccio registry
# Build with: docker build --secret id=NPM_AUTHTOKEN,env=NPM_AUTHTOKEN -t <image> .
RUN --mount=type=secret,id=NPM_AUTHTOKEN \
    TOKEN=$(cat /run/secrets/NPM_AUTHTOKEN) \
 && echo "registry=https://i-verdaccio-insulcloud.i360-infra-dev-cluster-ik-eaf5bc950b7aa3accb3329ec6e66e231-0000.eu-de.containers.appdomain.cloud/" > /root/.npmrc \
 && echo "//i-verdaccio-insulcloud.i360-infra-dev-cluster-ik-eaf5bc950b7aa3accb3329ec6e66e231-0000.eu-de.containers.appdomain.cloud/:_authToken=${TOKEN}" >> /root/.npmrc \
 && npm install -g sbom-sentinel \
 && rm /root/.npmrc

WORKDIR /app

# Default config location — mount your sbom-sentinel.config.json here
VOLUME ["/app/artifacts"]

ENTRYPOINT ["sbom-sentinel"]
CMD ["scan"]

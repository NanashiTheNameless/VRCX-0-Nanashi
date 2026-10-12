FROM gcr.io/distroless/static-debian12

ARG TARGETARCH
COPY --chmod=755 dist/vrcx-0-logger-${TARGETARCH} /usr/local/bin/vrcx-0-logger
COPY dist/LICENSE dist/THIRD_PARTY_NOTICES.txt /usr/share/licenses/vrcx-0-logger/

ENV VRCX0_LOGGER_DATA_DIR=/data
VOLUME /data
EXPOSE 8787

ENTRYPOINT ["/usr/local/bin/vrcx-0-logger"]

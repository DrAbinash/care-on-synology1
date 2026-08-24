# =============================================================================
# DICOM Print SCP -> Windows/CUPS printer bridge
#
# One container, four jobs:
#   1. pynetdicom Print SCP listening on DICOM_PORT (default 104)
#   2. CUPS (port 631) so the web admin UI can add the network/Windows-shared
#      printer this bridge spools to
#   3. The Python calibration + layout + print pipeline (server.py)
#   4. An HTTP API on HTTP_PORT (default 8090) so a hospital/ERP web app can
#      print directly, with no DICOM modality involved at all
#
# Deliberately plain Dockerfile syntax - no `# syntax=` directive and no
# heredocs - so it also builds with the classic builder and on a machine that
# cannot pull the BuildKit frontend image from Docker Hub (common behind a
# hospital firewall).
# =============================================================================
FROM python:3.11-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# cups/cups-client/cups-bsd  - the CUPS daemon + lp/lpstat/lpadmin commands
# cups-filters/ghostscript   - PDF/raster conversion filters CUPS needs to spool to real printers
# smbclient                  - provides smbspool, the backend that lets CUPS print to a Windows-shared queue
# printer-driver-all/-gutenprint - broad driver coverage, incl. native Epson/Canon inkjet support
# fonts-dejavu-core          - the clinic-letterhead header/footer text needs a real TTF, not PIL's bitmap default
# tini                       - a proper PID 1 so signals are handled correctly with two long-running processes
RUN apt-get update && apt-get install -y --no-install-recommends \
        cups \
        cups-client \
        cups-bsd \
        cups-filters \
        ghostscript \
        smbclient \
        printer-driver-all \
        printer-driver-gutenprint \
        fonts-dejavu-core \
        tini \
        procps \
    && rm -rf /var/lib/apt/lists/*

# Debian's smbclient package doesn't always leave the CUPS backend symlink in
# place; create it if it's missing so smb:// printer URIs work.
RUN if [ -x /usr/bin/smbspool ] && [ ! -e /usr/lib/cups/backend/smb ]; then \
        ln -s /usr/bin/smbspool /usr/lib/cups/backend/smb; \
    fi

COPY cups/cupsd.conf /etc/cups/cupsd.conf

# Point CUPS's logs at the container's stderr instead of at files nobody will
# ever open, so `docker logs` shows printer problems, then stash a pristine
# copy of the whole configuration directory somewhere a bind mount over
# /etc/cups cannot hide it. The entrypoint restores from there when it finds
# /etc/cups empty - see docker-entrypoint.sh for why that happens.
RUN sed -i 's/\r$//' /etc/cups/cupsd.conf \
    && sed -i -e '/^ *ErrorLog/d' -e '/^ *AccessLog/d' -e '/^ *PageLog/d' /etc/cups/cups-files.conf \
    && printf '\nErrorLog stderr\nAccessLog /dev/null\nPageLog /dev/null\n' >> /etc/cups/cups-files.conf \
    && cp -a /etc/cups /opt/cups-defaults

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py config_store.py job_store.py identity_audit.py image_profiles.py admin_auth.py admin_routes.py admin_ui.html .
COPY docker-entrypoint.sh /app/docker-entrypoint.sh

# Strip CRs defensively: cloning this repo on Windows without the shipped
# .gitattributes would otherwise leave a "#!/bin/sh\r" shebang, and the
# container would die at startup with an unhelpful "no such file or directory".
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh

# The rendered print-job audit trail and any header/footer logo image. Map
# these to real host folders in Container Manager / docker-compose (see the
# deployment guide) rather than relying on anonymous volumes.
#
# /etc/cups is deliberately NOT declared here even though it is meant to be
# mounted: it holds configuration this image ships, and it is the entrypoint's
# job to seed a freshly-mounted empty folder with it.
VOLUME ["/data/print-jobs", "/data/branding"]

EXPOSE 104 631 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python3 -c "import os,socket; socket.create_connection(('127.0.0.1', int(os.environ.get('DICOM_PORT','104'))), timeout=3).close()" || exit 1

ENV DICOM_AET=PRINTSCP \
    DICOM_PORT=104 \
    ALLOWED_CALLING_AETS= \
    GAMMA=2.0 \
    CONTRAST_LOW_PERCENTILE=1.0 \
    CONTRAST_HIGH_PERCENTILE=99.0 \
    ENABLE_CALIBRATION=true \
    PAGE_SIZE=A4 \
    PAGE_ORIENTATION=PORTRAIT \
    DPI=300 \
    MARGIN_MM=5.0 \
    GUTTER_MM=2.0 \
    LAYOUT_ROWS=2 \
    LAYOUT_COLS=3 \
    STRETCH_TO_FIT=false \
    AUTO_FIT_LAYOUT=true \
    BATCH_GROUP_BY=auto \
    BATCH_IDLE_TIMEOUT_SECONDS=60 \
    BACKGROUND_COLOR=WHITE \
    HEADER_LINE1= \
    HEADER_LINE2= \
    HEADER_LOGO_PATH= \
    HEADER_ALIGN=CENTER \
    HEADER_HEIGHT_MM=14.0 \
    FOOTER_LINE1= \
    FOOTER_LINE2= \
    FOOTER_LOGO_PATH= \
    FOOTER_ALIGN=CENTER \
    FOOTER_HEIGHT_MM=10.0 \
    BANNER_BACKGROUND_COLOR=BLACK \
    OUTPUT_DIR=/data/print-jobs \
    OUTPUT_FORMAT=pdf \
    JOB_RETENTION_DAYS=30 \
    PRINT_METHOD=cups \
    START_CUPS=true \
    CUPS_SERVER=localhost:631 \
    CUPS_PRINTER_NAME= \
    JETDIRECT_HOST= \
    JETDIRECT_PORT=9100 \
    SESSION_TTL_MINUTES=120 \
    LOG_LEVEL=INFO \
    HTTP_PORT=8090 \
    HTTP_BRIDGE_SECRET= \
    HTTP_MAX_BODY_BYTES=60000000 \
    HTTP_MAX_IMAGES_PER_JOB=200

ENTRYPOINT ["tini", "--"]
CMD ["/app/docker-entrypoint.sh"]

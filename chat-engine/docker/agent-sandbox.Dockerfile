# Outer image for the agent sandbox: a rootless podman host.
FROM node:24-trixie

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        podman \
        runc \
        uidmap \
        catatonit \
        passt \
        fuse-overlayfs \
        ca-certificates \
        inotify-tools \
        iproute2 \
    && rm -rf /var/lib/apt/lists/*

# Rootless podman user and subordinate uid/gid ranges.
RUN useradd -m -u 2000 -s /bin/bash sandbox \
    && echo 'sandbox:100000:6553600' > /etc/subuid \
    && echo 'sandbox:100000:6553600' > /etc/subgid

# Podman runs nested without systemd; storage is moved under /workspaces at runtime.
RUN mkdir -p /etc/containers \
    && printf '%s\n' \
        '[engine]' \
        'cgroup_manager = "cgroupfs"' \
        'events_logger = "file"' \
        'runtime = "runc"' \
        > /etc/containers/containers.conf \
    && printf '%s\n' \
        '[storage]' \
        'driver = "overlay"' \
        > /etc/containers/storage.conf \
    && printf '%s\n' \
        'unqualified-search-registries = ["docker.io"]' \
        > /etc/containers/registries.conf

# Runtime mount points.
RUN mkdir -p /home/sandbox/.local/share/containers /workspaces \
    && chown -R sandbox:sandbox /home/sandbox/.local \
    && chmod 711 /workspaces

WORKDIR /workspaces

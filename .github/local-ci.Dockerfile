FROM ghcr.io/actions/actions-runner:2.336.0@sha256:0cfdcc701ce933c6d243c6b0b2da767366dc9f2e99961d4c3754b0b78084cdda

# Local CI bind-mounts Worktree and snapshot files from hzia-box-eu. Match the
# runner account to that host user so pnpm can update a restored node_modules.
USER root

RUN groupmod --gid 2000 ubuntu \
  && usermod --uid 2000 --gid 2000 ubuntu \
  && groupmod --gid 1000 runner \
  && usermod --uid 1000 --gid 1000 runner \
  && chown -R runner:runner /home/runner \
  && apt-get update \
  && apt-get install -y --no-install-recommends xauth xvfb zip \
  && rm -rf /var/lib/apt/lists/*

USER runner

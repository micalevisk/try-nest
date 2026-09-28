export const UPSTREAM_OWNER = "nestjs";
export const UPSTREAM_REPOSITORY = "nest";
export const UPSTREAM_REF = "master";

export const USER_AGENT = "try-nest (+https://github.com/micalevisk/try-nest)";

export const TREE_ENDPOINT = `https://api.github.com/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPOSITORY}/git/trees/${UPSTREAM_REF}?recursive=1`;

export const RAW_CONTENT_BASE = `https://raw.githubusercontent.com/${UPSTREAM_OWNER}/${UPSTREAM_REPOSITORY}/${UPSTREAM_REF}`;

export const ARCHIVE_ENDPOINT = `https://codeload.github.com/${UPSTREAM_OWNER}/${UPSTREAM_REPOSITORY}/tar.gz/${UPSTREAM_REF}`;

/** The archive's own root directory, which is stripped during extraction. */
export const ARCHIVE_ROOT = `${UPSTREAM_REPOSITORY}-${UPSTREAM_REF}`;

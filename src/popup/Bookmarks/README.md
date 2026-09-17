# Secure Bookmarks

Local bookmarks (not synced with the browser's bookmarks). Opening one re-checks the
site (`scan:url`, domain scope) first: Dangerous → not opened; Suspicious → confirm;
otherwise opened in a new tab. The last verdict is stored with the bookmark.
Data: `bookmarkStore`.

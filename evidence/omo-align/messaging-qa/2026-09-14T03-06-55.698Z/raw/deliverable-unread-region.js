/**
 * R1: drop interjection REQUESTS from an auto-delivery unread set.
 *
 * `fallbackMailboxPrompt` packs EVERY unread mailbox record verbatim and the
 * scheduler delivers it at the next idle edge, so a request written into an ordinary
 * inbox would be delivered WITHOUT the captain's approval. Pending requests are
 * therefore filtered out of both auto-delivery reads; they reach a member only after
 * `decideInterjection(..., 'approved')` re-posts them as an ordinary message.
 *
 * A cleared TOMBSTONE is dropped here as well, not only inside `readUnreadMailbox`:
 * this function is the scheduler's LAST gate before a wake-up, so it stays correct
 * even if it is handed a record set that still contains cleared rows (e.g. a caller
 * reading `readMailbox` directly). Belt-and-braces on the delivery boundary.
 * @param messages - unread mailbox records.
 * @returns the records that may auto-deliver.
 */
function deliverableUnread(messages) {
    return messages.filter((message) => message.kind !== INTERJECTION_KIND && message.tombstone !== true);
}

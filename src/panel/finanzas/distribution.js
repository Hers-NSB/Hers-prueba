export const shareRecipient = ({ member_id, creator_id }) => member_id ? `chatter:${member_id}` : `model:${creator_id}`;

export function effectiveShare(rates, recipient, day) {
  return rates.findLast((rate) => shareRecipient(rate) === recipient && rate.effective_on <= day);
}

export const isChatter = (role) => /(^|,) *chatters? *(,|$)/i.test(role ?? "");

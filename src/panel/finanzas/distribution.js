export const shareRecipient = ({ member_id, creator_id }) => member_id ? `chatter:${member_id}` : `model:${creator_id}`;

export function effectiveShare(rates, recipient, day) {
  return rates.findLast((rate) => shareRecipient(rate) === recipient && rate.effective_on <= day);
}

export const isChatter = (role) => /(^|,) *chatters? *(,|$)/i.test(role ?? "");

export function memberRateInputs(rate) {
  const creator_ids = rate?.creator_ids ?? [];
  const chatter_ids = rate?.chatter_ids ?? [];
  const chatterOnly = chatter_ids.length && !creator_ids.length && rate.basis !== "employee_sales";
  return { percent: chatterOnly ? rate.chatter_percent : rate?.percent ?? 0, creator_ids, chatter_ids };
}

export function memberRateAllocation(percent, creatorIds, chatterIds, ownSales) {
  return {
    p_percent: ownSales || creatorIds.length ? percent : 0,
    p_creator_ids: creatorIds,
    p_chatter_percent: chatterIds.length ? percent : 0,
    p_chatter_ids: chatterIds,
  };
}

export function memberRateLabel(rate, format) {
  const { percent } = memberRateInputs(rate);
  const chatter = Number(rate.chatter_percent ?? 0);
  return chatter > 0 && Number(percent) !== chatter ? `${format(percent)} + ${format(chatter)} chatters` : format(percent);
}

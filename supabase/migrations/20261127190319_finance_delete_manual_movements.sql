grant delete on public.finance_movements to authenticated;

create policy finance_delete_manual_movements on public.finance_movements
  for delete to authenticated
  using (finance_payment_id is null and (select public.finance_is_admin()));

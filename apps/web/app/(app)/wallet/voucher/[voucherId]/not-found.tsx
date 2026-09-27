import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@yourtal/ui/button";
import { EmptyState } from "@yourtal/ui/empty-state";
import { PageContainer } from "@yourtal/ui/page-container";

/** Rendered when `getWalletVoucher` finds no voucher for the given id (6.5.b). */
export default async function WalletVoucherNotFound() {
  const t = await getTranslations("wallet");
  return (
    <PageContainer width="narrow" className="py-6">
      <EmptyState
        title={t("voucherDetail.notFoundTitle")}
        description={t("voucherDetail.notFoundBody")}
        action={
          <Button asChild variant="secondary">
            <Link href="/wallet">{t("voucherDetail.backToWallet")}</Link>
          </Button>
        }
      />
    </PageContainer>
  );
}

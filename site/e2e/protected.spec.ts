import { test, expect } from '@playwright/test';

test.describe('x402.Nano Protected Demo Page', () => {

    test('should display paywall and resolve after client-side polling and retry', async ({ page }) => {
        await page.goto('/protected');

        const paywall = page.locator('[data-testid="payment-required"]');
        await expect(paywall).toBeVisible();

        const addressElement = page.locator('[data-testid="payment-address"]');
        await expect(addressElement).toBeVisible();

        const amountElement = page.locator('[data-testid="payment-amount-raw"]');
        await expect(amountElement).toBeVisible();

        const amountRaw = await amountElement.getAttribute('data-raw');
        expect(amountRaw).toBeTruthy();

        await page.getByTestId('payer-account-input').fill('nano_1111111111111111111111111111111111111111111111111111hifc8npp');
        await page.route('**/api/poll-for-demo?**', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    found: true,
                    sendHash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
                    payerAccount: 'nano_1111111111111111111111111111111111111111111111111111hifc8npp',
                })
            });
        });

        await page.getByTestId('start-polling').click();

        const statusElement = page.locator('[data-testid="payment-status"]');
        await expect(statusElement).toHaveAttribute('data-status', 'verifying');
        await expect(page.locator('[data-testid="protected-content"]')).toBeVisible();
    });

});

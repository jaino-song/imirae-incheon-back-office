import { getErrorMessage } from './prisma-error-mapper';
import { t } from '@/lib/i18n/translations';

const FALLBACK_KEY = 'clients.form.error-save-failed';
const fallback = t('ko', FALLBACK_KEY);

function axiosError(status: number, data: unknown) {
    return { response: { status, data } };
}

describe('getErrorMessage', () => {
    it('still maps a Prisma error code ahead of any raw message', () => {
        const message = getErrorMessage(
            axiosError(409, {
                statusCode: 409,
                code: 'P2002',
                error: 'Conflict',
                field: 'phone',
            }),
            'ko',
            FALLBACK_KEY,
        );

        expect(message).not.toBe(fallback);
        expect(message).not.toBe('Conflict');
    });

    it('surfaces an actionable backend message instead of the generic fallback', () => {
        const message = getErrorMessage(
            axiosError(400, {
                error: 'duration must equal the Korean business-day count (15) for the submitted service period',
            }),
            'ko',
            FALLBACK_KEY,
        );

        expect(message).toBe(
            'duration must equal the Korean business-day count (15) for the submitted service period',
        );
    });

    it('surfaces a Korean backend message verbatim', () => {
        const message = getErrorMessage(
            axiosError(400, { error: '서비스 시작일은 종료일보다 늦을 수 없습니다.' }),
            'ko',
            FALLBACK_KEY,
        );

        expect(message).toBe('서비스 시작일은 종료일보다 늦을 수 없습니다.');
    });

    it.each([
        'Bad Request',
        'bad request',
        'Conflict',
        'Internal Server Error',
        'Unauthorized',
        'Not Found',
    ])('keeps the localized fallback for the bare HTTP status name %p', (statusName) => {
        const message = getErrorMessage(axiosError(400, { error: statusName }), 'ko', FALLBACK_KEY);

        expect(message).toBe(fallback);
    });

    it('keeps the localized fallback for the proxy placeholder message', () => {
        const message = getErrorMessage(
            axiosError(500, { error: 'Failed to create client' }),
            'ko',
            FALLBACK_KEY,
        );

        expect(message).toBe(fallback);
    });

    it('keeps the localized fallback when the payload carries nothing usable', () => {
        expect(getErrorMessage(axiosError(500, {}), 'ko', FALLBACK_KEY)).toBe(fallback);
        expect(getErrorMessage(new Error('boom'), 'ko', FALLBACK_KEY)).toBe(fallback);
        expect(getErrorMessage(null, 'ko', FALLBACK_KEY)).toBe(fallback);
    });

    it('reads a message field when the payload was not flattened by the proxy', () => {
        const message = getErrorMessage(
            axiosError(400, { message: '자동 고객 등록이 꺼져 있습니다.', error: 'Bad Request' }),
            'ko',
            FALLBACK_KEY,
        );

        expect(message).toBe('자동 고객 등록이 꺼져 있습니다.');
    });
});

/**
 * Preserves saved positions for ids that are not currently displayed while
 * re-sequencing displayed ids into their new order. Newly displayed ids that
 * are absent from the saved order are appended at the end.
 */
export function mergeRuleOrder(
    savedOrder: readonly string[],
    newDisplayedOrder: readonly string[],
): string[] {
    const savedIds = new Set(savedOrder);
    const displayedIds = new Set(newDisplayedOrder);
    const reorderedSavedIds = newDisplayedOrder.filter((id) => savedIds.has(id));
    let reorderedIndex = 0;

    const mergedOrder = savedOrder.map((id) => {
        if (!displayedIds.has(id)) {
            return id;
        }

        const reorderedId = reorderedSavedIds[reorderedIndex];
        reorderedIndex += 1;
        return reorderedId ?? id;
    });

    for (const id of newDisplayedOrder) {
        if (!savedIds.has(id)) {
            mergedOrder.push(id);
        }
    }

    return mergedOrder;
}

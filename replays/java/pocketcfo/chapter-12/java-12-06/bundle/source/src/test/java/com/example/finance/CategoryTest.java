package com.example.finance;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CategoryTest {

    @Test
    void twoArgConstructorLeavesPriorityUnset() {
        Category category = new Category("Groceries", new BigDecimal("100.00"));
        assertTrue(category.getPriority().isEmpty());
    }

    @Test
    void threeArgConstructorStoresGivenPriority() {
        Category category = new Category("Rent", new BigDecimal("1200.00"), 1);
        assertEquals(1, category.getPriority().orElseThrow());
    }

    @Test
    void toStringReturnsOnlyTheCategoryName() {
        Category category = new Category("Rent", new BigDecimal("1200.00"), 1);
        assertEquals("Rent", category.toString());
    }
}

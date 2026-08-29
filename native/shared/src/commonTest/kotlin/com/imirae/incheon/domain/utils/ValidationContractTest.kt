package com.imirae.incheon.domain.utils

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ValidationContractTest {
    @Test
    fun registrationFieldsAreRequiredAndMatchBackendShapes() {
        assertFalse(Validation.validateKoreanPhoneNumber("").isValid)
        assertTrue(Validation.validateKoreanPhoneNumber("010-1234-5678").isValid)
        assertTrue(Validation.validateKoreanPhoneNumber("01112345678").isValid)
        assertFalse(Validation.validateBirthDate("").isValid)
        assertTrue(Validation.validateBirthDate("1990-01-01").isValid)
        assertFalse(Validation.validateBirthDate("1990/01/01").isValid)
    }

    @Test
    fun registrationPasswordRequiresBackendSpecialCharacterRule() {
        assertFalse(Validation.validatePasswordStrength("StrongPass1").isValid)
        assertTrue(Validation.validatePasswordStrength("Strong!Pass1").isValid)
    }
}

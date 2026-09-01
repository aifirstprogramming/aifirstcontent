package com.example.finance;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class RecurringObligationRepositoryTest {

    @Test
    void updateReplacesTheMatchingObligation(@TempDir Path tempDir) {
        RecurringObligationRepository repository = new RecurringObligationRepository(new DataPaths(tempDir));
        repository.add(new RecurringObligation("Streaming", new BigDecimal("120.00"),
                12, LocalDate.of(2026, 1, 15), null, null));

        repository.update("Streaming", new RecurringObligation("Streaming Plus",
                new BigDecimal("150.00"), 12, LocalDate.of(2026, 1, 15), null, "upgraded plan"));

        List<RecurringObligation> obligations = repository.findAll();
        assertEquals(1, obligations.size());
        assertEquals("Streaming Plus", obligations.get(0).getName());
        assertEquals(new BigDecimal("150.00"), obligations.get(0).getAmount());
        assertEquals("upgraded plan", obligations.get(0).getDescription().orElse(""));
    }

    @Test
    void removeDeletesTheMatchingObligation(@TempDir Path tempDir) {
        RecurringObligationRepository repository = new RecurringObligationRepository(new DataPaths(tempDir));
        repository.add(new RecurringObligation("Streaming", new BigDecimal("120.00"),
                12, LocalDate.of(2026, 1, 15), null, null));
        repository.add(new RecurringObligation("Gym", new BigDecimal("40.00"),
                1, LocalDate.of(2026, 1, 1), null, null));

        repository.remove("Streaming");

        List<RecurringObligation> obligations = repository.findAll();
        assertEquals(1, obligations.size());
        assertEquals("Gym", obligations.get(0).getName());
    }

    @Test
    void loadsOlderLinesThatStillHaveTheDroppedCategoryColumn(@TempDir Path tempDir) throws Exception {
        DataPaths dataPaths = new DataPaths(tempDir);
        Files.createDirectories(tempDir);
        Files.writeString(dataPaths.recurringObligationsFile(), String.join("\n",
                "# name|categoryName|amount|intervalMonths|startDate|endDate|description|amountPaid",
                "Streaming|Subscriptions|120.00|12|2026-01-15||Automatic renewal|50.00") + "\n");

        RecurringObligationRepository repository = new RecurringObligationRepository(dataPaths);
        List<RecurringObligation> obligations = repository.findAll();

        assertEquals(1, obligations.size());
        assertEquals("Streaming", obligations.get(0).getName());
        assertEquals(new BigDecimal("120.00"), obligations.get(0).getAmount());
        assertEquals(new BigDecimal("50.00"), obligations.get(0).getAmountPaid());
    }
}

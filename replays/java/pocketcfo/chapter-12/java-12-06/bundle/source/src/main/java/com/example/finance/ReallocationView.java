package com.example.finance;

import javafx.beans.property.ReadOnlyObjectProperty;
import javafx.collections.FXCollections;
import javafx.collections.ObservableList;
import javafx.geometry.Insets;
import javafx.scene.control.Button;
import javafx.scene.control.ComboBox;
import javafx.scene.control.Label;
import javafx.scene.control.Tab;
import javafx.scene.control.TextField;
import javafx.scene.layout.FlowPane;
import javafx.scene.layout.VBox;

import java.math.BigDecimal;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;

/**
 * A "what if" preview: pick a category to hypothetically budget less for
 * going forward, an amount, and a savings goal or obligation to redirect
 * that amount to, and see the projected old-vs-new monthly target,
 * allocation, and progress — without recording anything for real.
 */
public class ReallocationView {

    private final CategoryRepository categoryRepository;
    private final SavingsGoalRepository savingsGoalRepository;
    private final RecurringObligationRepository recurringObligationRepository;
    private final ReallocationService reallocationService;
    private final ReadOnlyObjectProperty<YearMonth> selectedMonth;

    private final ObservableList<Category> categoryOptions = FXCollections.observableArrayList();
    private final ObservableList<TargetOption> targetOptions = FXCollections.observableArrayList();

    private final Label targetResultLabel = new Label();
    private final Label allocatedResultLabel = new Label();
    private final Label progressResultLabel = new Label();

    public ReallocationView(CategoryRepository categoryRepository, SavingsGoalRepository savingsGoalRepository,
                             RecurringObligationRepository recurringObligationRepository,
                             ReallocationService reallocationService,
                             ReadOnlyObjectProperty<YearMonth> selectedMonth) {
        this.categoryRepository = categoryRepository;
        this.savingsGoalRepository = savingsGoalRepository;
        this.recurringObligationRepository = recurringObligationRepository;
        this.reallocationService = reallocationService;
        this.selectedMonth = selectedMonth;
        refresh();
    }

    public Tab asTab() {
        Tab tab = new Tab("Reallocation", buildContent());
        tab.setClosable(false);
        return tab;
    }

    public void refresh() {
        categoryOptions.setAll(categoryRepository.findAll());
        List<TargetOption> options = new ArrayList<>();
        for (SavingsGoal goal : savingsGoalRepository.findAll()) {
            options.add(new TargetOption(goal.getName(), ReallocationService.TargetKind.SAVINGS_GOAL,
                    goal.getName() + " (Savings Goal)"));
        }
        for (RecurringObligation obligation : recurringObligationRepository.findAll()) {
            options.add(new TargetOption(obligation.getName(), ReallocationService.TargetKind.RECURRING_OBLIGATION,
                    obligation.getName() + " (Obligation)"));
        }
        targetOptions.setAll(options);
    }

    /** A pickable entry in the combined Savings Goal/Obligation dropdown. */
    private static final class TargetOption {
        private final String plainName;
        private final ReallocationService.TargetKind kind;
        private final String label;

        TargetOption(String plainName, ReallocationService.TargetKind kind, String label) {
            this.plainName = plainName;
            this.kind = kind;
            this.label = label;
        }

        String getPlainName() {
            return plainName;
        }

        ReallocationService.TargetKind getKind() {
            return kind;
        }

        @Override
        public String toString() {
            return label;
        }
    }

    private VBox buildContent() {
        ComboBox<Category> categoryBox = new ComboBox<>(categoryOptions);
        categoryBox.setPromptText("Category to budget less for");
        TextField amountField = new TextField();
        amountField.setPromptText("Reduction amount");
        ComboBox<TargetOption> targetBox = new ComboBox<>(targetOptions);
        targetBox.setPromptText("Savings goal or obligation");
        Label status = new Label();
        status.setWrapText(true);

        Button previewButton = new Button("Preview");
        previewButton.setOnAction(e -> {
            Category category = categoryBox.getValue();
            TargetOption target = targetBox.getValue();
            if (category == null || target == null) {
                status.setText("Category and a savings goal or obligation are both required.");
                return;
            }
            try {
                BigDecimal amount = new BigDecimal(amountField.getText().trim());
                ReallocationService.ReallocationProjection projection = target.getKind() == ReallocationService.TargetKind.SAVINGS_GOAL
                        ? reallocationService.projectToGoal(category.getName(), amount, target.getPlainName(), selectedMonth.get())
                        : reallocationService.projectToObligation(category.getName(), amount, target.getPlainName(), selectedMonth.get());
                showProjection(projection);
                status.setText("");
            } catch (NumberFormatException ex) {
                status.setText("Reduction amount must be a number.");
            } catch (IllegalArgumentException ex) {
                status.setText(ex.getMessage());
            }
        });

        for (Label label : List.of(targetResultLabel, allocatedResultLabel, progressResultLabel)) {
            label.setWrapText(true);
        }

        FlowPane form = new FlowPane(8, 8, new Label("Reallocate:"), categoryBox, amountField, targetBox,
                previewButton, status);
        VBox results = new VBox(6, targetResultLabel, allocatedResultLabel, progressResultLabel);

        VBox root = new VBox(16, form, results);
        root.setPadding(new Insets(12));
        return root;
    }

    private void showProjection(ReallocationService.ReallocationProjection projection) {
        String allocatedVerb = projection.getTargetKind() == ReallocationService.TargetKind.SAVINGS_GOAL
                ? "saved" : "paid";
        targetResultLabel.setText(String.format("%s monthly target: $%s → $%s",
                projection.getCategory().getName(), projection.getOldMonthlyTarget(),
                projection.getNewMonthlyTarget()));
        allocatedResultLabel.setText(String.format("%s %s: $%s → $%s",
                projection.getTargetName(), allocatedVerb, projection.getOldAllocatedToTarget(),
                projection.getNewAllocatedToTarget()));
        progressResultLabel.setText(String.format("%s progress: %.0f%% → %.0f%%",
                projection.getTargetName(), projection.getOldProgressPercent() * 100,
                projection.getNewProgressPercent() * 100));
    }
}

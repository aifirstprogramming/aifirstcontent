package com.example.finance;

import javafx.beans.property.SimpleObjectProperty;
import javafx.beans.property.SimpleStringProperty;
import javafx.collections.FXCollections;
import javafx.collections.ObservableList;
import javafx.geometry.Insets;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.control.Tab;
import javafx.scene.control.TableColumn;
import javafx.scene.control.TableRow;
import javafx.scene.control.TableView;
import javafx.scene.layout.VBox;

import java.math.BigDecimal;
import java.time.YearMonth;
import java.util.List;

/**
 * Category vs. target vs. actual for the current month, with over-budget
 * rows highlighted and a warning summary above the table.
 */
public class CategorySummaryView {

    private final BudgetService budgetService;
    private final YearMonth month;

    private final ObservableList<BudgetService.CategoryTotal> rows = FXCollections.observableArrayList();
    private final Label warningLabel = new Label();

    public CategorySummaryView(BudgetService budgetService) {
        this(budgetService, YearMonth.now());
    }

    public CategorySummaryView(BudgetService budgetService, YearMonth month) {
        this.budgetService = budgetService;
        this.month = month;
        refresh();
    }

    public Tab asTab() {
        Tab tab = new Tab("Categories", buildContent());
        tab.setClosable(false);
        return tab;
    }

    public void refresh() {
        List<BudgetService.CategoryTotal> totals = budgetService.categoryTotals(month);
        rows.setAll(totals);
        long overBudgetCount = totals.stream().filter(BudgetService.CategoryTotal::isOverBudget).count();
        warningLabel.setText(overBudgetCount == 0
                ? "All categories are within target."
                : overBudgetCount + " categor" + (overBudgetCount == 1 ? "y is" : "ies are") + " over budget.");
    }

    private VBox buildContent() {
        Button refreshButton = new Button("Refresh");
        refreshButton.setOnAction(e -> refresh());

        VBox root = new VBox(12, warningLabel, buildTable(), refreshButton);
        root.setPadding(new Insets(12));
        return root;
    }

    private TableView<BudgetService.CategoryTotal> buildTable() {
        TableView<BudgetService.CategoryTotal> table = new TableView<>(rows);

        TableColumn<BudgetService.CategoryTotal, String> nameCol = new TableColumn<>("Category");
        nameCol.setCellValueFactory(cell -> new SimpleStringProperty(cell.getValue().getCategory().getName()));

        TableColumn<BudgetService.CategoryTotal, BigDecimal> targetCol = new TableColumn<>("Target");
        targetCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getCategory().getMonthlyTarget()));

        TableColumn<BudgetService.CategoryTotal, BigDecimal> actualCol = new TableColumn<>("Actual");
        actualCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getTransactionActual()));

        TableColumn<BudgetService.CategoryTotal, BigDecimal> recurringCol = new TableColumn<>("Recurring (monthly)");
        recurringCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getRecurringMonthlyEquivalent()));

        TableColumn<BudgetService.CategoryTotal, BigDecimal> totalCol = new TableColumn<>("Total actual");
        totalCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getActual()));

        TableColumn<BudgetService.CategoryTotal, BigDecimal> remainingCol = new TableColumn<>("Remaining");
        remainingCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getRemaining()));

        table.getColumns().addAll(nameCol, targetCol, actualCol, recurringCol, totalCol, remainingCol);

        table.setRowFactory(tv -> new TableRow<>() {
            @Override
            protected void updateItem(BudgetService.CategoryTotal item, boolean empty) {
                super.updateItem(item, empty);
                setStyle(!empty && item != null && item.isOverBudget() ? "-fx-background-color: #f8d7da;" : "");
            }
        });

        return table;
    }
}

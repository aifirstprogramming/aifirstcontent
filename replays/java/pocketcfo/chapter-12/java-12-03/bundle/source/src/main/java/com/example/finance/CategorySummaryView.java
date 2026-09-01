package com.example.finance;

import javafx.beans.property.ReadOnlyObjectProperty;
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
import javafx.scene.control.TextField;
import javafx.scene.layout.FlowPane;
import javafx.scene.layout.VBox;

import java.math.BigDecimal;
import java.time.YearMonth;
import java.util.List;

/**
 * Category creation/edit/delete, plus category vs. target vs. actual for
 * the current month, with over-budget rows highlighted and a warning
 * summary above the table.
 */
public class CategorySummaryView {

    private final CategoryRepository categoryRepository;
    private final CategoryService categoryService;
    private final BudgetService budgetService;
    private final ReadOnlyObjectProperty<YearMonth> selectedMonth;

    private final ObservableList<BudgetService.CategoryTotal> rows = FXCollections.observableArrayList();
    private final Label warningLabel = new Label();

    public CategorySummaryView(CategoryRepository categoryRepository, CategoryService categoryService,
                                BudgetService budgetService, ReadOnlyObjectProperty<YearMonth> selectedMonth) {
        this.categoryRepository = categoryRepository;
        this.categoryService = categoryService;
        this.budgetService = budgetService;
        this.selectedMonth = selectedMonth;
        warningLabel.setWrapText(true);
        refresh();
    }

    public Tab asTab() {
        Tab tab = new Tab("Categories", buildContent());
        tab.setClosable(false);
        return tab;
    }

    public void refresh() {
        List<BudgetService.CategoryTotal> totals = budgetService.categoryTotals(selectedMonth.get());
        rows.setAll(totals);
        long overBudgetCount = totals.stream().filter(BudgetService.CategoryTotal::isOverBudget).count();
        warningLabel.setText(overBudgetCount == 0
                ? "All categories are within target."
                : overBudgetCount + " categor" + (overBudgetCount == 1 ? "y is" : "ies are") + " over budget.");
    }

    private VBox buildContent() {
        VBox root = new VBox(12, buildCategoryManagement(), warningLabel);
        root.setPadding(new Insets(12));
        return root;
    }

    private VBox buildCategoryManagement() {
        TextField nameField = new TextField();
        nameField.setPromptText("Category name");
        TextField targetField = new TextField();
        targetField.setPromptText("Monthly target");
        Label status = new Label();
        status.setWrapText(true);

        TableView<BudgetService.CategoryTotal> table = buildTable();

        Button saveButton = new Button("Add category");
        Button deleteButton = new Button("Delete selected");
        deleteButton.setDisable(true);
        Button refreshButton = new Button("Refresh");
        refreshButton.setOnAction(e -> refresh());

        table.getSelectionModel().selectedItemProperty().addListener((obs, oldSelection, newSelection) -> {
            if (newSelection != null) {
                Category category = newSelection.getCategory();
                nameField.setText(category.getName());
                targetField.setText(category.getMonthlyTarget().toString());
                saveButton.setText("Update category");
                deleteButton.setDisable(false);
            } else {
                saveButton.setText("Add category");
                deleteButton.setDisable(true);
            }
        });

        saveButton.setOnAction(e -> {
            String name = nameField.getText().trim();
            if (name.isEmpty()) {
                status.setText("Category name is required.");
                return;
            }
            try {
                BigDecimal monthlyTarget = new BigDecimal(targetField.getText().trim());
                BudgetService.CategoryTotal selected = table.getSelectionModel().getSelectedItem();
                if (selected == null) {
                    categoryRepository.add(new Category(name, monthlyTarget));
                    status.setText("Added category \"" + name + "\".");
                } else {
                    categoryService.update(selected.getCategory().getName(), new Category(name, monthlyTarget));
                    status.setText("Updated category \"" + name + "\".");
                }
                table.getSelectionModel().clearSelection();
                nameField.clear();
                targetField.clear();
                refresh();
            } catch (NumberFormatException ex) {
                status.setText("Monthly target must be a number.");
            }
        });

        deleteButton.setOnAction(e -> {
            BudgetService.CategoryTotal selected = table.getSelectionModel().getSelectedItem();
            if (selected == null) {
                return;
            }
            try {
                categoryService.delete(selected.getCategory().getName());
                table.getSelectionModel().clearSelection();
                nameField.clear();
                targetField.clear();
                status.setText("Deleted category \"" + selected.getCategory().getName() + "\".");
                refresh();
            } catch (IllegalStateException ex) {
                status.setText(ex.getMessage());
            }
        });

        FlowPane form = new FlowPane(8, 8, new Label("Category:"), nameField, targetField, saveButton,
                deleteButton, refreshButton, status);
        VBox root = new VBox(6, form, table);
        TableSelectionUtil.clearSelectionOnClickOutside(root, table);
        return root;
    }

    private TableView<BudgetService.CategoryTotal> buildTable() {
        TableView<BudgetService.CategoryTotal> table = new TableView<>(rows);

        TableColumn<BudgetService.CategoryTotal, String> nameCol = new TableColumn<>("Category");
        nameCol.setCellValueFactory(cell -> new SimpleStringProperty(cell.getValue().getCategory().getName()));

        TableColumn<BudgetService.CategoryTotal, BigDecimal> targetCol = new TableColumn<>("Target");
        targetCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getCategory().getMonthlyTarget()));

        TableColumn<BudgetService.CategoryTotal, BigDecimal> actualCol = new TableColumn<>("Actual");
        actualCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getActual()));

        TableColumn<BudgetService.CategoryTotal, BigDecimal> remainingCol = new TableColumn<>("Remaining");
        remainingCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getRemaining()));

        table.getColumns().addAll(nameCol, targetCol, actualCol, remainingCol);

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

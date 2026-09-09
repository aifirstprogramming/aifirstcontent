package com.example.finance;

import javafx.beans.property.ReadOnlyObjectProperty;
import javafx.beans.property.SimpleObjectProperty;
import javafx.beans.property.SimpleStringProperty;
import javafx.collections.FXCollections;
import javafx.collections.ObservableList;
import javafx.geometry.Insets;
import javafx.scene.Node;
import javafx.scene.control.Button;
import javafx.scene.control.ComboBox;
import javafx.scene.control.DatePicker;
import javafx.scene.control.Label;
import javafx.scene.control.Tab;
import javafx.scene.control.TableColumn;
import javafx.scene.control.TableView;
import javafx.scene.control.TextField;
import javafx.scene.layout.FlowPane;
import javafx.scene.layout.VBox;
import javafx.stage.FileChooser;
import javafx.stage.Window;

import java.io.File;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Transaction entry/edit/delete for the selected month. Categories, savings
 * goals, and obligations are all managed on their own tabs; this view just
 * picks from what's there and can assign a transaction to any of the three.
 */
public class TransactionEntryView {

    private final CategoryRepository categoryRepository;
    private final TransactionRepository transactionRepository;
    private final SavingsGoalRepository savingsGoalRepository;
    private final RecurringObligationRepository recurringObligationRepository;
    private final ReadOnlyObjectProperty<YearMonth> selectedMonth;

    private final ObservableList<CategoryOption> categoryOptions = FXCollections.observableArrayList();
    private final ObservableList<Transaction> monthTransactions = FXCollections.observableArrayList();

    public TransactionEntryView(CategoryRepository categoryRepository, TransactionRepository transactionRepository,
                                 SavingsGoalRepository savingsGoalRepository,
                                 RecurringObligationRepository recurringObligationRepository,
                                 ReadOnlyObjectProperty<YearMonth> selectedMonth) {
        this.categoryRepository = categoryRepository;
        this.transactionRepository = transactionRepository;
        this.savingsGoalRepository = savingsGoalRepository;
        this.recurringObligationRepository = recurringObligationRepository;
        this.selectedMonth = selectedMonth;
        refresh();
    }

    public Tab asTab() {
        Tab tab = new Tab("Transactions", buildContent());
        tab.setClosable(false);
        return tab;
    }

    public void refresh() {
        List<CategoryOption> options = new ArrayList<>();
        for (Category category : categoryRepository.findAll()) {
            options.add(new CategoryOption(category.getName(), category.getName() + " (Category)"));
        }
        for (SavingsGoal goal : savingsGoalRepository.findAll()) {
            options.add(new CategoryOption(goal.getName(), goal.getName() + " (Goal)"));
        }
        for (RecurringObligation obligation : recurringObligationRepository.findAll()) {
            options.add(new CategoryOption(obligation.getName(), obligation.getName() + " (Obligation)"));
        }
        categoryOptions.setAll(options);
        refreshTransactions();
    }

    /**
     * A pickable entry in the combined Category/Goal/Obligation dropdown —
     * whichever is picked, only its plain name is ever stored on the
     * Transaction, exactly as a plain category name always was.
     */
    private static final class CategoryOption {
        private final String plainName;
        private final String label;

        CategoryOption(String plainName, String label) {
            this.plainName = plainName;
            this.label = label;
        }

        String getPlainName() {
            return plainName;
        }

        @Override
        public String toString() {
            return label;
        }
    }

    private VBox buildContent() {
        VBox root = new VBox(12, buildTransactionManagement());
        root.setPadding(new Insets(12));
        return root;
    }

    private VBox buildTransactionManagement() {
        DatePicker datePicker = new DatePicker(LocalDate.now());
        ComboBox<TransactionType> typeBox = new ComboBox<>(FXCollections.observableArrayList(TransactionType.values()));
        typeBox.setValue(TransactionType.EXPENSE);
        ComboBox<CategoryOption> categoryBox = new ComboBox<>(categoryOptions);
        TextField amountField = new TextField();
        amountField.setPromptText("Amount");
        TextField descriptionField = new TextField();
        descriptionField.setPromptText("Description");
        Label status = new Label();
        status.setWrapText(true);

        TableView<Transaction> table = buildTransactionTable();

        Button saveButton = new Button("Add transaction");
        Button deleteButton = new Button("Delete selected");
        deleteButton.setDisable(true);
        Button importCsvButton = new Button("Import CSV");

        table.getSelectionModel().selectedItemProperty().addListener((obs, oldSelection, newSelection) -> {
            if (newSelection != null) {
                datePicker.setValue(newSelection.getDate());
                typeBox.setValue(newSelection.getType());
                categoryOptions.stream()
                        .filter(c -> c.getPlainName().equals(newSelection.getCategoryName()))
                        .findFirst()
                        .ifPresent(categoryBox::setValue);
                amountField.setText(newSelection.getAmount().toString());
                descriptionField.setText(newSelection.getDescription());
                saveButton.setText("Update transaction");
                deleteButton.setDisable(false);
            } else {
                saveButton.setText("Add transaction");
                deleteButton.setDisable(true);
            }
        });

        saveButton.setOnAction(e -> {
            LocalDate date = datePicker.getValue();
            TransactionType type = typeBox.getValue();
            CategoryOption categoryOption = categoryBox.getValue();
            if (date == null || type == null || categoryOption == null) {
                status.setText("Date, type, and category are required.");
                return;
            }
            try {
                BigDecimal amount = new BigDecimal(amountField.getText().trim());
                String description = descriptionField.getText().trim();
                Transaction selected = table.getSelectionModel().getSelectedItem();
                if (selected == null) {
                    transactionRepository.add(date, type, categoryOption.getPlainName(), amount, description);
                    status.setText("Added transaction.");
                } else {
                    transactionRepository.update(selected.getId(), date, type, categoryOption.getPlainName(),
                            amount, description);
                    status.setText("Updated transaction.");
                }
                table.getSelectionModel().clearSelection();
                amountField.clear();
                descriptionField.clear();
                refreshTransactions();
            } catch (NumberFormatException ex) {
                status.setText("Amount must be a number.");
            }
        });

        deleteButton.setOnAction(e -> {
            Transaction selected = table.getSelectionModel().getSelectedItem();
            if (selected == null) {
                return;
            }
            transactionRepository.remove(selected.getId());
            table.getSelectionModel().clearSelection();
            status.setText("Deleted transaction.");
            refreshTransactions();
        });

        importCsvButton.setOnAction(e -> {
            FileChooser chooser = new FileChooser();
            chooser.setTitle("Import Transactions CSV");
            chooser.getExtensionFilters().add(new FileChooser.ExtensionFilter("CSV files", "*.csv"));
            Window window = ((Node) e.getSource()).getScene().getWindow();
            File file = chooser.showOpenDialog(window);
            if (file == null) {
                return;
            }
            try {
                TransactionCsvImporter.ImportResult result = new TransactionCsvImporter().importFile(file.toPath());
                List<Transaction> imported = transactionRepository.addAll(result.rows());
                status.setText(summarizeImport(imported.size(), result.errors()));
                table.getSelectionModel().clearSelection();
                refreshTransactions();
            } catch (TransactionCsvImportException ex) {
                status.setText("Import failed: " + ex.getMessage());
            }
        });

        FlowPane form = new FlowPane(8, 8, new Label("Transaction:"), datePicker, typeBox, categoryBox,
                amountField, descriptionField, saveButton, deleteButton, importCsvButton, status);
        VBox root = new VBox(6, form, table);
        TableSelectionUtil.clearSelectionOnClickOutside(root, table);
        return root;
    }

    private TableView<Transaction> buildTransactionTable() {
        TableView<Transaction> table = new TableView<>(monthTransactions);

        TableColumn<Transaction, LocalDate> dateCol = new TableColumn<>("Date");
        dateCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getDate()));

        TableColumn<Transaction, TransactionType> typeCol = new TableColumn<>("Type");
        typeCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getType()));

        TableColumn<Transaction, String> categoryCol = new TableColumn<>("Category");
        categoryCol.setCellValueFactory(cell -> new SimpleStringProperty(cell.getValue().getCategoryName()));

        TableColumn<Transaction, BigDecimal> amountCol = new TableColumn<>("Amount");
        amountCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getAmount()));

        TableColumn<Transaction, String> descriptionCol = new TableColumn<>("Description");
        descriptionCol.setCellValueFactory(cell -> new SimpleStringProperty(cell.getValue().getDescription()));

        table.getColumns().addAll(dateCol, typeCol, categoryCol, amountCol, descriptionCol);
        return table;
    }

    private String summarizeImport(int imported, List<TransactionCsvImporter.RowError> errors) {
        int total = imported + errors.size();
        StringBuilder summary = new StringBuilder("Imported " + imported + " of " + total + " rows.");
        if (!errors.isEmpty()) {
            summary.append(" ").append(errors.size()).append(" skipped: ");
            errors.stream().limit(3).forEach(err ->
                    summary.append("Row ").append(err.rowNumber()).append(": ").append(err.reason()).append("; "));
            if (errors.size() > 3) {
                summary.append("(+").append(errors.size() - 3).append(" more - see console log)");
            }
        }
        return summary.toString();
    }

    private void refreshTransactions() {
        YearMonth currentMonth = selectedMonth.get();
        monthTransactions.setAll(transactionRepository.findAll().stream()
                .filter(t -> YearMonth.from(t.getDate()).equals(currentMonth))
                .sorted(Comparator.comparing(Transaction::getDate))
                .toList());
    }
}

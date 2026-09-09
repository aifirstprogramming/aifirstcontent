package com.example.finance;

import javafx.beans.property.SimpleObjectProperty;
import javafx.beans.property.SimpleStringProperty;
import javafx.collections.FXCollections;
import javafx.collections.ObservableList;
import javafx.geometry.Insets;
import javafx.scene.control.Button;
import javafx.scene.control.ComboBox;
import javafx.scene.control.DatePicker;
import javafx.scene.control.Label;
import javafx.scene.control.Separator;
import javafx.scene.control.Spinner;
import javafx.scene.control.Tab;
import javafx.scene.control.TableColumn;
import javafx.scene.control.TableView;
import javafx.scene.control.TextField;
import javafx.scene.layout.FlowPane;
import javafx.scene.layout.VBox;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * Long-term/spread expenses (annual subscriptions, contracts): entry/edit/
 * delete, the full obligations table, and what's due within the lookahead
 * window. Each obligation must be assigned to an existing category, chosen
 * from the picker below, so its logged payments roll up into that
 * category's actual spend.
 */
public class RecurringObligationsView {

    private final RecurringObligationRepository recurringObligationRepository;
    private final RecurringObligationService recurringObligationService;
    private final CategoryRepository categoryRepository;

    private final ObservableList<RecurringObligation> obligationRows = FXCollections.observableArrayList();
    private final ObservableList<RecurringObligationService.UpcomingPayment> upcomingRows = FXCollections.observableArrayList();
    private final ObservableList<Category> categoryOptions = FXCollections.observableArrayList();

    public RecurringObligationsView(RecurringObligationRepository recurringObligationRepository,
                                     RecurringObligationService recurringObligationService,
                                     CategoryRepository categoryRepository) {
        this.recurringObligationRepository = recurringObligationRepository;
        this.recurringObligationService = recurringObligationService;
        this.categoryRepository = categoryRepository;
        refresh();
    }

    public Tab asTab() {
        Tab tab = new Tab("Obligations", buildContent());
        tab.setClosable(false);
        return tab;
    }

    public void refresh() {
        obligationRows.setAll(recurringObligationRepository.findAll());
        upcomingRows.setAll(recurringObligationService.upcomingPayments(LocalDate.now()));
        categoryOptions.setAll(categoryRepository.findAll());
    }

    private VBox buildContent() {
        VBox root = new VBox(12, buildObligationManagement(), new Separator(),
                new Label("Upcoming payments (next 60 days)"), buildUpcomingTable());
        root.setPadding(new Insets(12));
        return root;
    }

    private VBox buildObligationManagement() {
        TextField nameField = new TextField();
        nameField.setPromptText("Name");
        TextField amountField = new TextField();
        amountField.setPromptText("Amount");
        Spinner<Integer> intervalSpinner = new Spinner<>(1, 600, 12);
        intervalSpinner.setEditable(true);
        intervalSpinner.setPrefWidth(90);
        DatePicker startDatePicker = new DatePicker(LocalDate.now());
        DatePicker endDatePicker = new DatePicker();
        endDatePicker.setPromptText("End date (optional)");
        TextField descriptionField = new TextField();
        descriptionField.setPromptText("Notes (optional)");
        TextField amountPaidField = new TextField();
        amountPaidField.setPromptText("Paid so far (optional)");
        ComboBox<Category> categoryBox = new ComboBox<>(categoryOptions);
        categoryBox.setPromptText("Category");
        Label status = new Label();
        status.setWrapText(true);

        TableView<RecurringObligation> table = buildObligationTable();

        Button saveButton = new Button("Add obligation");
        Button deleteButton = new Button("Delete selected");
        deleteButton.setDisable(true);

        table.getSelectionModel().selectedItemProperty().addListener((obs, oldSelection, newSelection) -> {
            if (newSelection != null) {
                nameField.setText(newSelection.getName());
                amountField.setText(newSelection.getAmount().toString());
                intervalSpinner.getValueFactory().setValue(newSelection.getIntervalMonths());
                startDatePicker.setValue(newSelection.getStartDate());
                endDatePicker.setValue(newSelection.getEndDate().orElse(null));
                descriptionField.setText(newSelection.getDescription().orElse(""));
                amountPaidField.setText(newSelection.getAmountPaid().toString());
                categoryOptions.stream()
                        .filter(c -> c.getName().equals(newSelection.getCategoryName()))
                        .findFirst()
                        .ifPresent(categoryBox::setValue);
                saveButton.setText("Update obligation");
                deleteButton.setDisable(false);
            } else {
                saveButton.setText("Add obligation");
                deleteButton.setDisable(true);
                categoryBox.setValue(null);
            }
        });

        saveButton.setOnAction(e -> {
            String name = nameField.getText().trim();
            LocalDate startDate = startDatePicker.getValue();
            Category category = categoryBox.getValue();
            if (name.isEmpty() || startDate == null) {
                status.setText("Name and start date are required.");
                return;
            }
            if (category == null) {
                status.setText("Category is required.");
                return;
            }
            try {
                BigDecimal amount = new BigDecimal(amountField.getText().trim());
                String paidText = amountPaidField.getText().trim();
                BigDecimal amountPaid = paidText.isEmpty() ? BigDecimal.ZERO : new BigDecimal(paidText);
                RecurringObligation updated = new RecurringObligation(name, category.getName(), amount,
                        intervalSpinner.getValue(), startDate, endDatePicker.getValue(),
                        descriptionField.getText().trim(), amountPaid);
                RecurringObligation selected = table.getSelectionModel().getSelectedItem();
                if (selected == null) {
                    recurringObligationService.addObligation(updated);
                    status.setText("Added obligation \"" + name + "\".");
                } else {
                    recurringObligationService.updateObligation(selected.getName(), updated);
                    status.setText("Updated obligation \"" + name + "\".");
                }
                table.getSelectionModel().clearSelection();
                nameField.clear();
                amountField.clear();
                descriptionField.clear();
                amountPaidField.clear();
                endDatePicker.setValue(null);
                categoryBox.setValue(null);
                refresh();
            } catch (NumberFormatException ex) {
                status.setText("Amount and paid-so-far must be numbers.");
            } catch (IllegalArgumentException ex) {
                status.setText(ex.getMessage());
            }
        });

        deleteButton.setOnAction(e -> {
            RecurringObligation selected = table.getSelectionModel().getSelectedItem();
            if (selected == null) {
                return;
            }
            recurringObligationRepository.remove(selected.getName());
            table.getSelectionModel().clearSelection();
            nameField.clear();
            amountField.clear();
            descriptionField.clear();
            amountPaidField.clear();
            endDatePicker.setValue(null);
            categoryBox.setValue(null);
            status.setText("Deleted obligation \"" + selected.getName() + "\".");
            refresh();
        });

        FlowPane form = new FlowPane(8, 8, new Label("Obligation:"), nameField, categoryBox, amountField,
                intervalSpinner, startDatePicker, endDatePicker, descriptionField, amountPaidField,
                saveButton, deleteButton, status);
        VBox root = new VBox(6, form, table);
        TableSelectionUtil.clearSelectionOnClickOutside(root, table);
        return root;
    }

    private TableView<RecurringObligation> buildObligationTable() {
        TableView<RecurringObligation> table = new TableView<>(obligationRows);

        TableColumn<RecurringObligation, String> nameCol = new TableColumn<>("Name");
        nameCol.setCellValueFactory(cell -> new SimpleStringProperty(cell.getValue().getName()));

        TableColumn<RecurringObligation, String> categoryCol = new TableColumn<>("Category");
        categoryCol.setCellValueFactory(cell -> new SimpleStringProperty(cell.getValue().getCategoryName()));

        TableColumn<RecurringObligation, BigDecimal> amountCol = new TableColumn<>("Amount");
        amountCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getAmount()));

        TableColumn<RecurringObligation, Integer> intervalCol = new TableColumn<>("Every (months)");
        intervalCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getIntervalMonths()));

        TableColumn<RecurringObligation, BigDecimal> monthlyCol = new TableColumn<>("Monthly equiv.");
        monthlyCol.setCellValueFactory(cell ->
                new SimpleObjectProperty<>(recurringObligationService.monthlyEquivalent(cell.getValue())));

        TableColumn<RecurringObligation, LocalDate> startCol = new TableColumn<>("Start");
        startCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getStartDate()));

        TableColumn<RecurringObligation, String> endCol = new TableColumn<>("End");
        endCol.setCellValueFactory(cell -> new SimpleStringProperty(
                cell.getValue().getEndDate().map(LocalDate::toString).orElse("")));

        TableColumn<RecurringObligation, String> notesCol = new TableColumn<>("Notes");
        notesCol.setCellValueFactory(cell -> new SimpleStringProperty(cell.getValue().getDescription().orElse("")));

        TableColumn<RecurringObligation, BigDecimal> paidCol = new TableColumn<>("Paid to date");
        paidCol.setCellValueFactory(cell ->
                new SimpleObjectProperty<>(recurringObligationService.totalPaid(cell.getValue())));

        table.getColumns().addAll(nameCol, categoryCol, amountCol, intervalCol, monthlyCol, startCol, endCol,
                paidCol, notesCol);
        return table;
    }

    private TableView<RecurringObligationService.UpcomingPayment> buildUpcomingTable() {
        TableView<RecurringObligationService.UpcomingPayment> table = new TableView<>(upcomingRows);

        TableColumn<RecurringObligationService.UpcomingPayment, String> nameCol = new TableColumn<>("Obligation");
        nameCol.setCellValueFactory(cell -> new SimpleStringProperty(cell.getValue().getObligation().getName()));

        TableColumn<RecurringObligationService.UpcomingPayment, LocalDate> dueCol = new TableColumn<>("Due");
        dueCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getDueDate()));

        TableColumn<RecurringObligationService.UpcomingPayment, BigDecimal> amountCol = new TableColumn<>("Amount");
        amountCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getObligation().getAmount()));

        table.getColumns().addAll(nameCol, dueCol, amountCol);
        return table;
    }
}

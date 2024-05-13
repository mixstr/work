<?php
    global $databasehandler;
    $arguments = [
        'id' => $_POST['id'],
        'FIO' => $_POST['FIO'],
        'hire_date' => $_POST['hire_date'],
        'termination_date' => $_POST['termination_date'],
    ];
    require_once (__DIR__ . '/../configDB.php');
    $sql = file_get_contents(__DIR__ . '/../sql/updateemployees.sql');
    $query = $databasehandler->prepare($sql);
    $query->execute($arguments);
?>

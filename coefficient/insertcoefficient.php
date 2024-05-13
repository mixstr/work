<?php
    global $databasehandler;
    $arguments = [
        'id' => $_POST['id'],
        'employee_id' => $_POST['employee_id'],
        'month_id' => $_POST['month_id'],
        'coefficient' => $_POST['coefficient'],
    ];
    require_once (__DIR__ . '/../configDB.php');
    $sql = file_get_contents(__DIR__ . '/../sql/insertcoefficient.sql');
    $query = $databasehandler->prepare($sql);
    $query->execute($arguments);
?>

<?php
    require(dirname(__DIR__) . '/configDB.php');

    $sql = file_get_contents(dirname(__DIR__) . '/sql/updateCoefficient.sql');

    $arguments = [
        'id' => $_GET['id'],
        'employee_id' => $_GET['employee_id'],
        'month_id' => $_GET['month_id'],
        'coefficient' => $_GET['coefficient'],
    ];

    execution($sql, $arguments);
?>

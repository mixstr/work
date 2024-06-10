<?php
    require(dirname(__DIR__) . '/configDB.php');

    $sql = file_get_contents(dirname(__DIR__) . '/sql/insertMonth.sql');

    $arguments = [
        'id' => $_GET['id'],
        'name' => $_GET['name'],
        'day' => $_GET['day'],
        'month' => $_GET['month'],
        'year' => $_GET['year'],
    ];

    execution($sql, $arguments);
?>

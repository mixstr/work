<?php
    require_once(dirname(__FILE__) . '/../configDB.php');
    $sql = file_get_contents(dirname(__FILE__) . '/../sql/updateMonth.sql');
    $arguments = [
        'id' => $_GET['id'],
        'name' => $_GET['name'],
        'day' => $_GET['day'],
        'month' => $_GET['month'],
        'year' => $_GET['year'],
    ];
    execution($sql, $arguments);
?>

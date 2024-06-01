<?php
    require_once(dirname(__DIR__) . '/configDB.php');
    $sql = file_get_contents(dirname(__DIR__) . '/sql/selectEmployees.sql');
    $query = $databasehandler->query($sql);
    foreach ($query as $row) {
        print "<br/>";
        print $row['id'] . '-' . $row['fio'] . '-' . $row['hire_date'] . '-' . $row['termination_date'] . '<br/>';
    }
?>